const FingerprintTemplate = require('./model');
const { cadetLookup } = require('./validator');
const {
  FingerprintError,
  encryptTemplate,
  decryptTemplate
} = require('./utils');

function createFingerprintService({ Cadet, AuditLog, sdk, io, onVerified }) {
  async function findCadet(value, session = null) {
    const lookup = cadetLookup(value);
    const query = Cadet.findOne(lookup.query);
    if (session) query.session(session);
    const cadet = await query;
    if (!cadet) {
      throw new FingerprintError('Cadet not found.', {
        code: 'CADET_NOT_FOUND',
        statusCode: 404
      });
    }
    return cadet;
  }

  async function writeAudit({ action, cadet, actor, ipAddress, result, device, details = {}, session }) {
    await AuditLog.create([{
      action,
      roll: cadet?.roll || null,
      details: {
        cadetId: cadet?._id ? String(cadet._id) : null,
        cadetName: cadet?.name || null,
        officerId: actor,
        deviceSerial: device?.deviceSerial || null,
        deviceModel: device?.deviceModel || 'Mantra MFS110',
        ipAddress,
        result,
        ...details
      },
      timestamp: new Date()
    }], session ? { session } : undefined);
  }

  async function saveEnrollment({ cadetId, actor, ipAddress, reenroll = false }) {
    const cadet = await findCadet(cadetId);
    const existing = await FingerprintTemplate.findOne({ cadetId: cadet._id, status: 'ACTIVE' });
    if (existing && !reenroll) {
      throw new FingerprintError('A fingerprint is already enrolled for this cadet.', {
        code: 'FINGERPRINT_ALREADY_ENROLLED',
        statusCode: 409
      });
    }
    if (!existing && reenroll) {
      throw new FingerprintError('No fingerprint enrollment exists to replace.', {
        code: 'FINGERPRINT_NOT_ENROLLED',
        statusCode: 404
      });
    }

    io?.emit('fingerprint:capture-progress', { cadetId: String(cadet._id), stage: 'CAPTURING' });
    const capture = await sdk.capture();
    io?.emit('fingerprint:capture-progress', { cadetId: String(cadet._id), stage: 'GENERATING_TEMPLATE' });
    const encrypted = encryptTemplate(capture.template);
    const now = new Date();
    const session = await Cadet.startSession();

    try {
      await session.withTransaction(async () => {
        const credential = await FingerprintTemplate.findOneAndUpdate(
          { cadetId: cadet._id },
          {
            $set: {
              roll: cadet.roll,
              ...encrypted,
              templateVersion: capture.templateVersion,
              deviceModel: capture.deviceModel,
              deviceSerial: capture.deviceSerial,
              sdkVersion: capture.sdkVersion,
              captureQuality: capture.quality,
              enrolledBy: actor,
              enrolledAt: existing?.enrolledAt || now,
              updatedAt: now,
              lastVerifiedAt: null,
              verificationCount: 0,
              failedVerificationCount: 0,
              status: 'ACTIVE'
            }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true, session }
        );

        await Cadet.updateOne(
          { _id: cadet._id },
          {
            $set: {
              fingerprintEnrolled: true,
              fingerprintTemplateId: String(credential._id),
              fingerprintLastUpdated: now,
              fingerprint: {
                enrolled: true,
                templateId: String(credential._id),
                templateReference: `fingerprint_templates/${credential._id}`,
                templateVersion: capture.templateVersion,
                deviceModel: capture.deviceModel,
                deviceSerial: capture.deviceSerial,
                enrolledBy: actor,
                enrolledAt: existing?.enrolledAt || now,
                lastVerifiedAt: null,
                verificationCount: 0,
                status: 'ACTIVE'
              }
            }
          },
          { session }
        );

        await writeAudit({
          action: reenroll ? 'FINGERPRINT_UPDATED' : 'FINGERPRINT_ENROLLED',
          cadet,
          actor,
          ipAddress,
          result: 'SUCCESS',
          device: capture,
          details: { captureQuality: capture.quality, templateVersion: capture.templateVersion },
          session
        });
      });
    } finally {
      await session.endSession();
    }

    const result = await status(cadetId);
    io?.emit('fingerprint:enrollment-updated', result);
    io?.emit('fingerprint:capture-progress', { cadetId: String(cadet._id), stage: 'SUCCESS' });
    return result;
  }

  async function remove({ cadetId, actor, ipAddress }) {
    const cadet = await findCadet(cadetId);
    const credential = await FingerprintTemplate.findOne({ cadetId: cadet._id, status: 'ACTIVE' });
    if (!credential) {
      throw new FingerprintError('No fingerprint enrollment exists for this cadet.', {
        code: 'FINGERPRINT_NOT_ENROLLED',
        statusCode: 404
      });
    }
    const session = await Cadet.startSession();
    try {
      await session.withTransaction(async () => {
        await FingerprintTemplate.deleteMany({ cadetId: cadet._id }).session(session);
        await Cadet.updateOne(
          { _id: cadet._id },
          {
            $set: {
              fingerprintEnrolled: false,
              fingerprintTemplateId: null,
              fingerprintLastUpdated: new Date(),
              'fingerprint.enrolled': false,
              'fingerprint.templateId': null,
              'fingerprint.templateReference': null,
              'fingerprint.status': 'NOT_ENROLLED',
              'fingerprint.lastVerifiedAt': null,
              'fingerprint.verificationCount': 0
            }
          },
          { session }
        );
        await writeAudit({
          action: 'FINGERPRINT_REMOVED',
          cadet,
          actor,
          ipAddress,
          result: 'SUCCESS',
          device: credential,
          session
        });
      });
    } finally {
      await session.endSession();
    }
    const result = await status(cadetId);
    io?.emit('fingerprint:enrollment-updated', result);
    return result;
  }

  async function status(cadetId) {
    const cadet = await findCadet(cadetId);
    const credential = await FingerprintTemplate.findOne({
      cadetId: cadet._id,
      status: 'ACTIVE'
    }).lean();
    return {
      success: true,
      cadetId: String(cadet._id),
      roll: cadet.roll,
      name: cadet.name,
      enrolled: !!credential,
      status: credential ? 'ENROLLED' : 'NOT_ENROLLED',
      enrolledAt: credential?.enrolledAt || null,
      updatedAt: credential?.updatedAt || null,
      enrolledBy: credential?.enrolledBy || null,
      deviceModel: credential?.deviceModel || null,
      deviceSerial: credential?.deviceSerial || null,
      sdkVersion: credential?.sdkVersion || null,
      verificationCount: credential?.verificationCount || 0,
      lastVerifiedAt: credential?.lastVerifiedAt || null
    };
  }

  async function verify({ cadetId, actor, ipAddress, direction, terminal }) {
    const liveCapture = await sdk.capture();
    let credentials;
    let requestedCadet = null;
    if (cadetId) {
      requestedCadet = await findCadet(cadetId);
      credentials = await FingerprintTemplate.find({
        cadetId: requestedCadet._id,
        status: 'ACTIVE'
      }).select('+encryptedTemplate +encryptionIv +encryptionTag +templateHash');
    } else {
      const limit = Math.max(1, Math.min(
        Number(process.env.FINGERPRINT_IDENTIFICATION_LIMIT) || 500,
        2000
      ));
      credentials = await FingerprintTemplate.find({ status: 'ACTIVE' })
        .limit(limit)
        .select('+encryptedTemplate +encryptionIv +encryptionTag +templateHash');
    }

    if (!requestedCadet && liveCapture.providerMode === 'LOCAL_WORKFLOW_ADAPTER') {
      throw new FingerprintError(
        'Fingerprint identification requires a selected cadet until the hardware template provider is configured.',
        { code: 'FINGERPRINT_IDENTIFICATION_PROVIDER_REQUIRED', statusCode: 422 }
      );
    }

    if (!credentials.length) {
      throw new FingerprintError(
        requestedCadet ? 'This cadet has no enrolled fingerprint.' : 'No fingerprint enrollments are available.',
        { code: 'FINGERPRINT_NOT_ENROLLED', statusCode: 404 }
      );
    }

    let best = { credential: null, score: 0, threshold: null };
    for (const credential of credentials) {
      const comparison = await sdk.match(decryptTemplate(credential), liveCapture.template);
      if (comparison.score >= best.score) best = { credential, ...comparison };
      if (comparison.matched) break;
    }

    if (!best.credential || !best.matched) {
      if (requestedCadet) {
        await FingerprintTemplate.updateOne(
          { _id: credentials[0]._id },
          { $inc: { failedVerificationCount: 1 } }
        );
        await Promise.all([
          writeAudit({
            action: 'FINGERPRINT_MATCH_FAILED',
            cadet: requestedCadet,
            actor,
            ipAddress,
            result: 'NO_MATCH',
            device: liveCapture,
            details: { score: best.score, threshold: best.threshold, direction }
          }),
          writeAudit({
            action: 'FACE_FALLBACK_USED',
            cadet: requestedCadet,
            actor,
            ipAddress,
            result: 'REQUIRED',
            device: liveCapture,
            details: {
              reason: 'FINGERPRINT_MATCH_FAILED',
              score: best.score,
              threshold: best.threshold,
              direction
            }
          })
        ]);
      }
      return {
        success: false,
        matched: false,
        code: 'FINGERPRINT_MATCH_FAILED',
        message: 'Fingerprint did not match. Continue with face verification.',
        score: best.score,
        threshold: best.threshold,
        fallback: { method: 'FACE', endpoint: '/api/cadets/checkout' }
      };
    }

    const cadet = await Cadet.findById(best.credential.cadetId);
    if (!cadet) {
      throw new FingerprintError('Fingerprint credential is not linked to an active cadet.', {
        code: 'FINGERPRINT_CADET_MISSING',
        statusCode: 409
      });
    }
    const now = new Date();
    await Promise.all([
      FingerprintTemplate.updateOne(
        { _id: best.credential._id },
        { $set: { lastVerifiedAt: now }, $inc: { verificationCount: 1 } }
      ),
      Cadet.updateOne(
        { _id: cadet._id },
        {
          $set: {
            'fingerprint.lastVerifiedAt': now
          },
          $inc: { 'fingerprint.verificationCount': 1 }
        }
      ),
      writeAudit({
        action: 'FINGERPRINT_VERIFIED',
        cadet,
        actor,
        ipAddress,
        result: 'MATCH',
        device: liveCapture,
        details: { score: best.score, threshold: best.threshold, direction }
      })
    ]);

    let gateResult = null;
    if (direction && onVerified) {
      gateResult = await onVerified({
        cadetId: String(cadet._id),
        direction,
        actor,
        ipAddress,
        terminal,
        score: best.score,
        threshold: best.threshold
      });
      if (!gateResult?.success) {
        return {
          success: false,
          matched: true,
          code: gateResult?.code || 'GATE_ACCESS_DENIED',
          message: gateResult?.message || 'Identity verified, but gate access was denied.',
          score: best.score,
          threshold: best.threshold,
          direction,
          accessGranted: false,
          gate: gateResult
        };
      }
    }

    const result = {
      success: true,
      matched: true,
      code: 'FINGERPRINT_VERIFIED',
      cadet: {
        id: String(cadet._id),
        roll: cadet.roll,
        name: cadet.name,
        course: cadet.course,
        batch: cadet.batch
      },
      score: best.score,
      threshold: best.threshold,
      direction,
      gateValidationRequired: !direction,
      accessGranted: gateResult?.accessGranted ?? null,
      action: gateResult?.action || null,
      passId: gateResult?.passId || null,
      gatePassUrl: gateResult?.gatePassUrl || null,
      checkedOutAt: gateResult?.checkedOutAt || null,
      message: gateResult?.success
        ? 'Fingerprint verified. Checkout completed and gate access approved.'
        : 'Fingerprint verified.'
    };
    io?.emit('fingerprint:verified', {
      roll: cadet.roll,
      name: cadet.name,
      direction,
      verifiedAt: now
    });
    return result;
  }

  async function summary() {
    const today = new Date(new Date().setHours(0, 0, 0, 0));
    const [
      totalCadets,
      enrolled,
      verifiedToday,
      failedToday,
      faceFallbackToday,
      emergencyVerificationToday
    ] = await Promise.all([
      Cadet.countDocuments({}),
      FingerprintTemplate.countDocuments({ status: 'ACTIVE' }),
      AuditLog.countDocuments({
        action: 'FINGERPRINT_VERIFIED',
        timestamp: { $gte: today }
      }),
      AuditLog.countDocuments({
        action: 'FINGERPRINT_MATCH_FAILED',
        timestamp: { $gte: today }
      }),
      AuditLog.countDocuments({
        action: 'FACE_FALLBACK_USED',
        timestamp: { $gte: today }
      }),
      AuditLog.countDocuments({
        action: 'EMERGENCY_VERIFICATION_USED',
        timestamp: { $gte: today }
      })
    ]);
    return {
      success: true,
      totalCadets,
      enrolled,
      pending: Math.max(0, totalCadets - enrolled),
      verifiedToday,
      failedToday,
      faceFallbackToday,
      emergencyVerificationToday
    };
  }

  async function history({ limit = 50 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    const actions = [
      'FINGERPRINT_ENROLLED',
      'FINGERPRINT_UPDATED',
      'FINGERPRINT_REMOVED',
      'FINGERPRINT_VERIFIED',
      'FINGERPRINT_MATCH_FAILED',
      'FACE_FALLBACK_USED',
      'EMERGENCY_VERIFICATION_USED'
    ];
    const items = await AuditLog.find({ action: { $in: actions } })
      .sort({ timestamp: -1 })
      .limit(safeLimit)
      .lean();
    return {
      success: true,
      count: items.length,
      items: items.map((item) => ({
        id: String(item._id),
        action: item.action,
        roll: item.roll || null,
        timestamp: item.timestamp,
        details: item.details || {}
      }))
    };
  }

  return {
    enroll: (input) => saveEnrollment({ ...input, reenroll: false }),
    reenroll: (input) => saveEnrollment({ ...input, reenroll: true }),
    remove,
    status,
    verify,
    history,
    summary,
    deviceStatus: () => sdk.status()
  };
}

module.exports = { createFingerprintService };
