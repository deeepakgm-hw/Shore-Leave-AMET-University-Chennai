import { apiRequest } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import type {
  AdminSummary, AuditLog, BranchSummary, Cadet, DailyReport, GateActionResult, GateEvent, LeaveRequest,
  CadetImportResult, LeaveStatusSummary, MutationResult, NfcSummary, NotificationPage, ReportGenerationResult,
  ReportSettings, ReturnMonitor,
} from "@/types";

const BRANCHES = [
  { code: "BE-MAERSK", name: "B.E Marine Engineering", company: "Maersk" },
  { code: "BSC-MAERSK", name: "B.Sc Nautical Science", company: "Maersk" },
  { code: "ETO-MAERSK", name: "Electro-Technical Officer", company: "Maersk" },
  { code: "DNS-VSHIPS", name: "DNS", company: "V.Ships" },
  { code: "BE-VSHIPS", name: "B.E Marine Engineering", company: "V.Ships" },
] as const;

type BackendStats = {
  totalShoreLeave?: number;
  totalMedicalLeave?: number;
  totalSpecialLeave?: number;
  totalOverdue?: number;
  totalPendingHodApproval?: number;
  totalCheckedInToday?: number;
  totalCheckedOut?: number;
  totalLateReturns?: number;
  totalLeavesToday?: number;
  totalCadets?: number;
  blockedCadets?: number;
  blockedCadetPercentage?: number;
};

type BackendCadet = {
  _id?: string;
  id?: string;
  roll?: string;
  name?: string;
  email?: string;
  batch?: string;
  course?: string;
  photoUrl?: string;
  studentId?: string;
  contactNo?: string;
  status?: string;
  attendanceStatus?: string;
  gateStatus?: string;
  leaveStatus?: string;
  pendingLeave?: BackendPendingLeave | null;
  faceEnrollmentData?: { enrolled?: boolean; enrolledAt?: string | Date | null } | null;
  fingerprintEnrolled?: boolean;
  fingerprintLastUpdated?: string | Date | null;
  fingerprint?: {
    enrolled?: boolean;
    enrolledAt?: string | Date | null;
    lastVerifiedAt?: string | Date | null;
    verificationCount?: number;
  } | null;
  nfc?: { uid?: string | null; assigned?: boolean; status?: string | null; code?: string | null } | null;
  isBlocked?: boolean;
  leaveBlocked?: boolean;
  leaveBlockedReason?: string | null;
  leaveBlockedBy?: string | null;
  leaveBlockedDate?: string | Date | null;
  leaveBlockedUntil?: string | Date | null;
  leaveBlock?: {
    blocked?: boolean;
    reason?: string | null;
    blockedBy?: string | null;
    blockedAt?: string | Date | null;
    blockedUntil?: string | Date | null;
  };
};

type BackendPendingLeave = {
  requestId?: string;
  leaveType?: string;
  dest?: string;
  reason?: string;
  fromDate?: string;
  toDate?: string;
  returnDate?: string;
  requestedAt?: string;
  reviewedAt?: string;
  approvalStatus?: string;
  rejectionReason?: string;
  passId?: string;
  gatePassUrl?: string;
  gatePassPdfUrl?: string;
  documentUrl?: string;
  supportingDocument?: { publicUrl?: string; url?: string } | null;
};

type BackendAudit = {
  _id?: string;
  id?: string;
  timestamp?: string;
  createdAt?: string;
  occurred_at?: string;
  action?: string;
  actor?: string;
  roll?: string;
  details?: {
    uid?: string;
    gate?: string;
    decision?: string;
    direction?: string;
    method?: string;
    cadetName?: string;
    deviceName?: string;
    location?: string;
    [key: string]: unknown;
  };
};

type BackendDashboardRow = {
  _id?: string;
  roll?: string;
  name?: string;
  dest?: string;
  locationAddress?: string;
  leaveType?: string;
  status?: string;
  approvalStatus?: string;
  fromDate?: string;
  toDate?: string;
  checkOutDate?: string;
  checkInDate?: string;
  source?: string;
};

type BackendDashboardLive = {
  stats: BackendStats;
  liveStatus: BackendDashboardRow[];
  recentCheckins: BackendDashboardRow[];
  chart?: { labels?: string[]; active?: number[]; pending?: number[] };
};

type BackendFaceEnrollmentItem = {
  roll?: string;
  name?: string;
  email?: string;
  photoUrl?: string;
  facePhotoUrl?: string;
  enrolledAt?: string | null;
  documentId?: string | null;
};

type BackendFaceEnrollmentStatus = {
  completed?: BackendFaceEnrollmentItem[];
  pending?: BackendFaceEnrollmentItem[];
  counts?: { completed?: number; pending?: number };
};

export interface FaceEnrollmentPayload {
  roll: string;
  name?: string;
  email?: string;
  batch?: string;
  imageBase64: string;
  deviceInfo?: string;
}

export interface FaceEnrollmentResponse {
  success: boolean;
  roll: string;
  name?: string;
  photoUrl?: string;
  enrollmentVersion?: number;
  provider?: string;
  validationMode?: string;
}

const missingEndpoint = (name: string) =>
  Promise.reject(new Error(`Missing backend endpoint: ${name} is not exposed by Shore Leave Express.`));

function optionalIso(value?: string | Date | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export function normalizeCadet(cadet: BackendCadet): Cadet {
  const leaveBlock = cadet.leaveBlock;
  const leaveBlocked = Boolean(leaveBlock?.blocked ?? cadet.leaveBlocked);
  return {
    id: cadet.roll || cadet.id || cadet._id || "",
    _id: cadet._id,
    roll: cadet.roll,
    cadet_code: cadet.roll || cadet.studentId || cadet._id || "",
    full_name: cadet.name || cadet.roll || "Unnamed cadet",
    name: cadet.name,
    email: cadet.email,
    branch: cadet.course || cadet.batch,
    branch_code: cadet.course || cadet.batch || null,
    department: cadet.course || cadet.batch,
    phone: cadet.contactNo,
    is_outside: cadet.status === "out" || cadet.attendanceStatus === "OUTSIDE" || cadet.gateStatus === "OUTSIDE",
    attendance_state: cadet.attendanceStatus || cadet.gateStatus || cadet.status,
    face_enrolled: !!cadet.faceEnrollmentData?.enrolled,
    fingerprint_enrolled: Boolean(cadet.fingerprint?.enrolled ?? cadet.fingerprintEnrolled),
    fingerprint_enrolled_at: optionalIso(cadet.fingerprint?.enrolledAt ?? cadet.fingerprintLastUpdated),
    fingerprint_last_verified_at: optionalIso(cadet.fingerprint?.lastVerifiedAt),
    fingerprint_verification_count: Number(cadet.fingerprint?.verificationCount) || 0,
    nfc_card_id: cadet.nfc?.code || null,
    nfc_uid: cadet.nfc?.uid || null,
    current_leave_id: cadet.pendingLeave?.requestId || null,
    leave_blocked: leaveBlocked,
    leave_blocked_reason: leaveBlock?.reason ?? cadet.leaveBlockedReason ?? null,
    leave_blocked_by: leaveBlock?.blockedBy ?? cadet.leaveBlockedBy ?? null,
    leave_blocked_date: optionalIso(leaveBlock?.blockedAt ?? cadet.leaveBlockedDate),
    leave_blocked_until: optionalIso(leaveBlock?.blockedUntil ?? cadet.leaveBlockedUntil),
  };
}

function normalizeAudit(log: BackendAudit): AuditLog {
  const occurredAt = log.occurred_at || log.timestamp || log.createdAt || new Date().toISOString();
  return {
    id: log.id || log._id || `${log.action ?? "audit"}-${log.roll ?? "system"}-${occurredAt}`,
    occurred_at: occurredAt,
    created_at: log.createdAt,
    action: log.action,
    actor: log.actor,
    roll_number: log.roll,
    cadet_name: log.details?.cadetName,
    direction: log.details?.direction === "exit" ? "exit" : log.action?.includes("CHECKOUT") ? "exit" : "entry",
    method: (log.details?.method as GateEvent["method"]) || (log.action?.includes("NFC") ? "nfc" : "manual"),
    result: String(log.details?.decision || log.action || "SUCCESS"),
    nfc_uid: log.details?.uid,
    gate_name: log.details?.gate || log.details?.deviceName || log.details?.location,
  };
}

function normalizeLeaveRequest(cadet: BackendCadet): LeaveRequest {
  const leave = cadet.pendingLeave || {};
  const status = leave.approvalStatus === "approved"
    ? "approved"
    : leave.approvalStatus === "rejected"
      ? "rejected"
      : "pending";

  return {
    id: leave.requestId || cadet.roll || cadet._id || "",
    roll: cadet.roll,
    cadet_id: cadet.roll,
    cadet: normalizeCadet(cadet),
    destination: leave.dest || "—",
    reason: leave.reason || leave.leaveType || null,
    start_at: leave.fromDate || leave.requestedAt || new Date().toISOString(),
    end_at: leave.toDate || leave.returnDate || leave.fromDate || new Date().toISOString(),
    created_at: leave.requestedAt || leave.reviewedAt,
    status,
  };
}

export async function fetchAdminCadets(query = ""): Promise<Cadet[]> {
  if (query.includes("fields=face")) {
    const status = await apiRequest<BackendFaceEnrollmentStatus>(endpoints.admin.faceEnrollmentStatus);
    const completed = (status.completed ?? []).map((cadet) => normalizeCadet({
      roll: cadet.roll,
      name: cadet.name,
      email: cadet.email,
      photoUrl: cadet.photoUrl || cadet.facePhotoUrl,
      faceEnrollmentData: { enrolled: true, enrolledAt: cadet.enrolledAt },
    } as BackendCadet));
    const pending = (status.pending ?? []).map((cadet) => normalizeCadet({
      roll: cadet.roll,
      name: cadet.name,
      email: cadet.email,
      photoUrl: cadet.photoUrl || cadet.facePhotoUrl,
      faceEnrollmentData: { enrolled: false },
    } as BackendCadet));
    return [...completed, ...pending];
  }
  const cadets = (await apiRequest<BackendCadet[]>(endpoints.admin.cadets())).map(normalizeCadet);
  if (query.includes("isOutside=true")) return cadets.filter((cadet) => cadet.is_outside);
  if (query.includes("faceEnrolled=false")) return cadets.filter((cadet) => !cadet.face_enrolled);
  return cadets;
}

export async function fetchAdminSummary(): Promise<AdminSummary> {
  const [stats, cadets, faceCadets, logs] = await Promise.all([
    apiRequest<BackendStats>(endpoints.stats),
    fetchAdminCadets(),
    fetchAdminCadets("?fields=face"),
    apiRequest<BackendAudit[]>(endpoints.auditLogs),
  ]);
  const outside = cadets.filter((cadet) => cadet.is_outside).length;
  const faceEnrolled = faceCadets.filter((cadet) => cadet.face_enrolled).length;
  const unknownNfc = logs.filter((log) => log.action === "NFC_UNKNOWN_CARD").length;
  const denied = logs.filter((log) => String(log.details?.decision || log.action || "").toUpperCase().includes("DENIED")).length;
  const totalCadets = stats.totalCadets ?? cadets.length;
  const blockedCadets = stats.blockedCadets ?? cadets.filter((cadet) => cadet.leave_blocked).length;

  return {
    totalCadets,
    outside: stats.totalCheckedOut ?? outside,
    inside: Math.max(0, totalCadets - (stats.totalCheckedOut ?? outside)),
    pending: stats.totalPendingHodApproval ?? 0,
    approvedToday: stats.totalLeavesToday ?? 0,
    rejectedToday: logs.filter((log) => log.action === "LEAVE_REJECTED").length,
    gateEntries: stats.totalCheckedInToday ?? 0,
    gateExits: stats.totalCheckedOut ?? 0,
    faceEnrolled,
    facePending: Math.max(0, totalCadets - faceEnrolled),
    facePct: totalCadets ? Math.round((faceEnrolled / totalCadets) * 100) : 0,
    emergencyCodesToday: logs.filter((log) => String(log.action || "").includes("EMERGENCY_CODE_GENERATED")).length,
    lateReturns: stats.totalLateReturns ?? 0,
    unknownNfc,
    denied,
    blockedCadets,
    blockedCadetPercentage: stats.blockedCadetPercentage ?? (totalCadets ? Math.round((blockedCadets / totalCadets) * 100) : 0),
  };
}

export async function fetchRecentGateHistory(): Promise<AuditLog[]> {
  return (await apiRequest<BackendAudit[]>(endpoints.auditLogs)).map(normalizeAudit);
}

export async function fetchReportSettings(): Promise<ReportSettings> {
  const response = await apiRequest<{ settings: { runTime?: string; enabled?: boolean; recipients?: string[]; formats?: string[] } }>(endpoints.reports.settings);
  return { ...response.settings, run_time: response.settings.runTime };
}

export async function updateReportSettings(patch: ReportSettings): Promise<void> {
  await apiRequest(endpoints.reports.settings, {
    method: "PUT",
    body: JSON.stringify({ ...patch, runTime: patch.run_time }),
  });
}

export async function fetchDailyReports(): Promise<DailyReport[]> {
  const response = await apiRequest<{ reports?: Array<Record<string, unknown>> }>(endpoints.reports.daily());
  return (response.reports ?? []).map((report) => ({
    id: String(report._id || report.id || ""),
    report_date: String(report.reportDate || ""),
    generated_at: String(report.generatedAt || ""),
    delivery_status: String(report.status || "generated"),
    storage_url: String(report.signedUrl || report.publicUrl || "") || null,
    error: report.error ? String(report.error) : null,
  }));
}

export async function generateDailyReport(date?: string): Promise<ReportGenerationResult> {
  const response = await apiRequest<{ success: boolean; report?: Record<string, unknown> }>(endpoints.reports.generate, {
    method: "POST",
    body: JSON.stringify({ date, format: "pdf" }),
  });
  return {
    ok: response.success,
    reportId: response.report?._id ? String(response.report._id) : undefined,
    signedUrl: response.report?.signedUrl ? String(response.report.signedUrl) : response.report?.publicUrl ? String(response.report.publicUrl) : undefined,
  };
}

export function importCadets(cadets: Array<Record<string, unknown>>) {
  return apiRequest<CadetImportResult>(endpoints.admin.importCadets, {
    method: "POST",
    body: JSON.stringify({ cadets }),
  });
}

export function fetchNotifications(query = "?limit=25") {
  return apiRequest<NotificationPage>(endpoints.notifications.list(query));
}

export function markNotificationRead(id: string) {
  return apiRequest<MutationResult>(endpoints.notifications.read(id), { method: "PATCH" });
}

export function markAllNotificationsRead() {
  return apiRequest<MutationResult>(endpoints.notifications.markAllRead, { method: "POST" });
}

export function archiveNotification(id: string, archived = true) {
  return apiRequest<MutationResult>(endpoints.notifications.archive(id), { method: "PATCH", body: JSON.stringify({ archived }) });
}

export function deleteNotification(id: string) {
  return apiRequest<MutationResult>(endpoints.notifications.remove(id), { method: "DELETE" });
}

export async function fetchReturnMonitor(): Promise<ReturnMonitor> {
  const live = await apiRequest<BackendDashboardLive>(endpoints.dashboard.live);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const active = live.liveStatus ?? [];
  const sameDay = (value: string | undefined, date: Date) => {
    if (!value) return false;
    const parsed = new Date(value);
    return parsed.toDateString() === date.toDateString();
  };
  const overdueRows = active.filter((row) => row.status === "overdue" || (row.toDate && !row.checkInDate && new Date(row.toDate) < today));
  return {
    today: active.filter((row) => sameDay(row.toDate, today)).length,
    tomorrow: active.filter((row) => sameDay(row.toDate, tomorrow)).length,
    overdue: overdueRows.length,
    overdueList: overdueRows.map((row) => ({
      id: row._id || `${row.roll}-${row.toDate}`,
      roll: row.roll,
      cadet: { id: row.roll || "", cadet_code: row.roll || "", full_name: row.name || row.roll || "—" },
      destination: row.locationAddress || row.dest || "—",
      start_at: row.fromDate || row.checkOutDate || new Date().toISOString(),
      end_at: row.toDate || new Date().toISOString(),
      status: "expired",
    })),
  };
}

export async function fetchRecentRequests(): Promise<LeaveRequest[]> {
  return (await apiRequest<BackendCadet[]>(endpoints.admin.leaveRequests())).map(normalizeLeaveRequest);
}

export async function fetchRecentGate(): Promise<GateEvent[]> {
  const logs = await fetchRecentGateHistory();
  return logs.slice(0, 20).map((log) => ({
    id: log.id,
    cadet_name: log.cadet_name,
    roll_number: log.roll_number,
    direction: log.direction === "exit" || log.direction === "CHECK_OUT" ? "exit" : "entry",
    method: log.method,
    occurred_at: log.occurred_at,
    gate_name: log.gate_name,
    result: log.result,
    nfc_uid: log.nfc_uid,
    cadet: log.roll_number ? { id: log.roll_number, cadet_code: log.roll_number, full_name: log.cadet_name || log.roll_number } : undefined,
  }));
}

export async function fetchNfcSummary(): Promise<NfcSummary> {
  const cadets = await fetchAdminCadets();
  const assigned = cadets.filter((cadet) => !!cadet.nfc_uid).length;
  return { assigned, pending: Math.max(0, cadets.length - assigned) };
}

export async function fetchLeaveStatusSummary(): Promise<LeaveStatusSummary> {
  const stats = await apiRequest<BackendStats>(endpoints.stats);
  return {
    approved: stats.totalLeavesToday ?? 0,
    pending: stats.totalPendingHodApproval ?? 0,
    rejected: 0,
    returned: stats.totalCheckedInToday ?? 0,
  };
}

export async function fetchBranchSummary(): Promise<BranchSummary[]> {
  const [cadets, pending] = await Promise.all([fetchAdminCadets(), fetchRecentRequests()]);
  return BRANCHES.map((branch) => {
    const rows = cadets.filter((cadet) =>
      [cadet.branch, cadet.branch_code, cadet.department].filter(Boolean).some((value) => String(value).toLowerCase().includes(branch.name.toLowerCase().split(" ")[0])),
    );
    const outside = rows.filter((cadet) => cadet.is_outside).length;
    return {
      code: branch.code,
      label: `${branch.name} (${branch.company})`,
      total: rows.length,
      outside,
      pending: pending.filter((request) => rows.some((cadet) => cadet.roll === request.roll)).length,
      approved: 0,
      compliance: rows.length ? Math.round(((rows.length - outside) / rows.length) * 100) : 100,
    };
  });
}

export function enrollCadetFace(payload: FaceEnrollmentPayload) {
  return apiRequest<FaceEnrollmentResponse>(endpoints.face.enrollFace, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function sendFaceEnrollmentReminder(roll: string) {
  return apiRequest<MutationResult>(endpoints.admin.faceEnrollmentReminder(roll), { method: "POST" });
}

export type LeaveBlockPayload = {
  reason: string;
  blockedUntil?: string | null;
};

export async function blockCadetLeave(roll: string, payload: LeaveBlockPayload): Promise<Cadet> {
  const response = await apiRequest<{ success: boolean; cadet?: BackendCadet }>(endpoints.admin.blockCadetLeave(roll), {
    method: "POST",
    body: JSON.stringify({ reason: payload.reason, blockUntil: payload.blockedUntil ?? null }),
  });
  if (!response.cadet) throw new Error("Cadet block response did not include cadet data.");
  return normalizeCadet(response.cadet);
}

export async function unblockCadetLeave(roll: string): Promise<Cadet> {
  const response = await apiRequest<{ success: boolean; cadet?: BackendCadet }>(endpoints.admin.unblockCadetLeave(roll), {
    method: "POST",
  });
  if (!response.cadet) throw new Error("Cadet unblock response did not include cadet data.");
  return normalizeCadet(response.cadet);
}

export function decideLeave(roll: string, status: "approved" | "rejected", reason?: string) {
  return apiRequest<MutationResult>(endpoints.admin.decideLeave(roll), {
    method: "PUT", body: JSON.stringify({ status, reason }),
  });
}

export function recordGateEvent(): Promise<GateEvent> {
  return missingEndpoint("manual gate event creation");
}

export function setCadetOutside(cadetId: string, isOutside: boolean) {
  return apiRequest<MutationResult>(endpoints.admin.blockCadet(cadetId), {
    method: "PUT", body: JSON.stringify({ isBlocked: !isOutside }),
  });
}

export const checkInCadet = (cadetId: string, method: "face" | "nfc" | "emergency" = "emergency") =>
  apiRequest<GateActionResult>(endpoints.gate.checkIn, { method: "POST", body: JSON.stringify({ roll: cadetId, cadetId, method }) });

export const checkOutCadet = (cadetId: string, method: "face" | "nfc" | "emergency" = "emergency") =>
  apiRequest<GateActionResult>(endpoints.gate.checkOut, { method: "POST", body: JSON.stringify({ roll: cadetId, cadetId, method }) });
