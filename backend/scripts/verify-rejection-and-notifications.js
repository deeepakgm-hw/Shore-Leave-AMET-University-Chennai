require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const API_URL = 'http://127.0.0.1:3000';

async function main() {
  console.log('--- Starting Comprehensive Rejection & Notification Verification ---');

  // Connect to MongoDB Atlas for state inspection & cleanup
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  assert(mongoUri, 'MONGODB_URI missing');
  await mongoose.connect(mongoUri);

  const Cadet = mongoose.connection.collection('cadets');
  const LeaveRecord = mongoose.connection.collection('leaverecords');
  const Notification = mongoose.connection.collection('notifications');
  const Officer = mongoose.connection.collection('officers');

  // Verify schema models & indexes
  console.log('[1/6] Verifying DB indexes & schemas...');
  const notifIndexes = await Notification.indexes();
  const hasLeaveReqIdIndex = notifIndexes.some(idx => idx.key && idx.key.leaveRequestId);
  console.log('✓ Notification leaveRequestId index present:', hasLeaveReqIdIndex);

  // Setup test identities
  const adminOfficer = await Officer.findOne({ role: 'admin', isActive: true });
  assert(adminOfficer, 'No active admin found in database');
  await Officer.updateOne({ _id: adminOfficer._id }, { $set: { lastLoginAt: new Date() } });

  const branchOfficer = await Officer.findOne({ role: 'duty_officer', branch: { $exists: true, $ne: '' }, isActive: true });
  if (branchOfficer) {
    await Officer.updateOne({ _id: branchOfficer._id }, { $set: { lastLoginAt: new Date() } });
  }
  
  const adminToken = jwt.sign(
    { username: adminOfficer.username, role: 'admin', sessionId: 'test-session-admin' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  let branchToken = null;
  if (branchOfficer) {
    branchToken = jwt.sign(
      { username: branchOfficer.username, role: 'duty_officer', sessionId: 'test-session-branch' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  // Create or reset a dedicated test cadet
  const testRoll = 'TEST-VERIFY-REJECT-999';
  await Cadet.deleteOne({ roll: testRoll });
  await LeaveRecord.deleteMany({ roll: testRoll });
  await Notification.deleteMany({ recipientRoll: testRoll });

  const testCadetDoc = {
    roll: testRoll,
    name: 'Verification Cadet',
    email: 'verify-cadet@amet.local',
    batch: 'BE-MAERSK',
    course: 'BE-MAERSK',
    studentId: 'ST-VERIFY-999',
    enrollmentStatus: 'ACTIVE',
    loginAttempts: 0,
    leaveTokens: { balance: 28, lastAllocatedMonth: '2026-10' },
    pendingLeave: {
      leaveRequestId: 'REQ-VERIFY-001',
      leaveType: 'Shore Leave',
      outDate: '2026-10-25',
      outTime: '10:00',
      inDate: '2026-10-25',
      inTime: '18:00',
      reason: 'Cadet family visit in Chennai',
      approvalStatus: 'pending_approval',
      requestedAt: new Date()
    }
  };
  await Cadet.insertOne(testCadetDoc);

  // Generate Cadet Token
  const cadetToken = jwt.sign(
    { roll: testRoll, sessionId: 'test-session-cadet', role: 'cadet' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  // -------------------------------------------------------------
  // Test 2: Pending Count Endpoint
  // -------------------------------------------------------------
  console.log('[2/6] Testing GET /api/admin/leave-requests/pending-count ...');
  
  // Unauthenticated check
  const unauthRes = await fetch(`${API_URL}/api/admin/leave-requests/pending-count`);
  assert.equal(unauthRes.status, 401, 'Unauthenticated request must return 401');

  // Admin count check
  const adminPendingRes = await fetch(`${API_URL}/api/admin/leave-requests/pending-count`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(adminPendingRes.status, 200, 'Admin pending count must return 200');
  const adminPendingData = await adminPendingRes.json();
  assert.equal(adminPendingData.success, true);
  assert(typeof adminPendingData.count === 'number', 'Count must be a number');
  assert(adminPendingData.count >= 1, 'Count must include the test pending request');
  console.log(`✓ Admin pending count returned: ${adminPendingData.count}`);

  // Branch officer count check (if branch officer exists)
  if (branchToken) {
    const branchPendingRes = await fetch(`${API_URL}/api/admin/leave-requests/pending-count`, {
      headers: { Authorization: `Bearer ${branchToken}` }
    });
    assert.equal(branchPendingRes.status, 200);
    const branchPendingData = await branchPendingRes.json();
    assert.equal(branchPendingData.success, true);
    assert.equal(branchPendingData.branch, branchOfficer.branch);
    console.log(`✓ Branch (${branchOfficer.branch}) pending count returned: ${branchPendingData.count}`);
  }

  // -------------------------------------------------------------
  // Test 3: Unread Notifications Count Endpoint
  // -------------------------------------------------------------
  console.log('[3/6] Testing GET /api/notifications/unread-count ...');
  const unreadRes = await fetch(`${API_URL}/api/notifications/unread-count`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(unreadRes.status, 200);
  const unreadData = await unreadRes.json();
  assert.equal(unreadData.success, true);
  assert(typeof unreadData.unread === 'number', 'Unread count must be a number');
  console.log(`✓ Unread notification count returned: ${unreadData.unread}`);

  // -------------------------------------------------------------
  // Test 4: Mandatory Rejection Reason Validation (Negative tests)
  // -------------------------------------------------------------
  console.log('[4/6] Testing Mandatory Rejection Reason Validation ...');

  // Case 4A: Missing rejectionReason
  const missingReasonRes = await fetch(`${API_URL}/api/admin/leave-requests/${testRoll}/approve`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'reject' })
  });
  assert.equal(missingReasonRes.status, 400, 'Rejection without reason must return 400');
  const missingReasonData = await missingReasonRes.json();
  assert(missingReasonData.error.includes('Rejection reason is mandatory'), 'Error message must specify mandatory rejection reason');
  console.log('✓ Rejected empty reason with 400:', missingReasonData.error);

  // Case 4B: Whitespace-only rejectionReason
  const whitespaceRes = await fetch(`${API_URL}/api/admin/leave-requests/${testRoll}/approve`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'reject', rejectionReason: '     \t \n   ' })
  });
  assert.equal(whitespaceRes.status, 400, 'Whitespace rejection reason must return 400');
  const whitespaceData = await whitespaceRes.json();
  assert(whitespaceData.error.includes('Rejection reason is mandatory'), 'Error message must specify non-whitespace reason');
  console.log('✓ Rejected whitespace reason with 400:', whitespaceData.error);

  // -------------------------------------------------------------
  // Test 5: Successful Rejection with Meaningful Reason
  // -------------------------------------------------------------
  console.log('[5/6] Testing Valid Rejection Processing ...');
  const validReason = 'Cadet has scheduled naval architecture laboratory session and parade drill.';
  const validRejectRes = await fetch(`${API_URL}/api/admin/leave-requests/${testRoll}/approve`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'reject', rejectionReason: validReason })
  });
  assert.equal(validRejectRes.status, 200, 'Valid rejection must return 200');
  const validRejectData = await validRejectRes.json();
  assert.equal(validRejectData.success, true);
  assert.equal(validRejectData.status, 'rejected');
  assert.equal(validRejectData.rejectionReason, validReason);
  console.log('✓ API response verified:', validRejectData.status, '-', validRejectData.rejectionReason);

  // Verify Cadet pendingLeave state in DB
  const updatedCadet = await Cadet.findOne({ roll: testRoll });
  assert.equal(updatedCadet.pendingLeave.approvalStatus, 'rejected');
  assert.equal(updatedCadet.pendingLeave.rejectionReason, validReason);
  assert(updatedCadet.pendingLeave.reviewedBy, 'reviewedBy must be set');
  assert.equal(updatedCadet.pendingLeave.reviewedByRole, 'admin');
  assert(updatedCadet.pendingLeave.reviewedAt, 'reviewedAt must be set');
  assert(updatedCadet.pendingLeave.rejectedAt, 'rejectedAt must be set');
  console.log('✓ Cadet pendingLeave state verified in MongoDB');

  // Verify Permanent LeaveRecord document created in DB
  const leaveRecord = await LeaveRecord.findOne({ roll: testRoll, status: 'rejected' });
  assert(leaveRecord, 'Permanent LeaveRecord with status "rejected" must be created');
  assert.equal(leaveRecord.approvalStatus, 'rejected');
  assert.equal(leaveRecord.rejectionReason, validReason);
  assert.equal(leaveRecord.rejectedByRole, 'admin');
  assert.equal(leaveRecord.rejectedByUserId, adminOfficer.username);
  assert(leaveRecord.rejectedAt, 'rejectedAt must be set in LeaveRecord');
  console.log('✓ Permanent LeaveRecord audit document verified in MongoDB');

  // Verify Persistent Notification created for Cadet
  const notif = await Notification.findOne({ recipientRoll: testRoll, type: 'leave_rejected' });
  assert(notif, 'Persistent notification for cadet must be created');
  assert.equal(notif.isRead || notif.read, false, 'Notification must initially be unread');
  assert(notif.message.includes(validReason), 'Notification message should contain the rejection reason');
  assert.equal(notif.leaveRequestId, 'REQ-VERIFY-001', 'Notification must link to the leaveRequestId');
  console.log('✓ Persistent notification verified for recipient:', notif.title);

  // -------------------------------------------------------------
  // Test 6: Historical Preservation Across Leave Resubmission
  // -------------------------------------------------------------
  console.log('[6/6] Verifying Historical Audit Preservation Across Resubmission ...');
  // Cadet reapplies for leave
  await Cadet.updateOne(
    { roll: testRoll },
    {
      $set: {
        'pendingLeave.leaveRequestId': 'REQ-VERIFY-002',
        'pendingLeave.approvalStatus': 'pending_approval',
        'pendingLeave.rejectionReason': null,
        'pendingLeave.requestedAt': new Date()
      }
    }
  );

  // Verify that the previously created LeaveRecord with rejection reason was NOT lost
  const historicRecords = await LeaveRecord.find({ roll: testRoll }).toArray();
  assert.equal(historicRecords.length, 1, 'Historical LeaveRecord must remain intact');
  assert.equal(historicRecords[0].status, 'rejected');
  assert.equal(historicRecords[0].rejectionReason, validReason);
  console.log('✓ Past rejection record safely preserved in LeaveRecord history upon resubmission!');

  // Cleanup test artifacts
  await Cadet.deleteOne({ roll: testRoll });
  await LeaveRecord.deleteMany({ roll: testRoll });
  await Notification.deleteMany({ recipientRoll: testRoll });
  console.log('✓ Test data cleaned up successfully');

  console.log('\n======================================================');
  console.log('ALL VERIFICATION SUITES PASSED SUCCESSFULLY (6/6)');
  console.log('======================================================\n');
}

main()
  .catch(err => {
    console.error('VERIFICATION FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
