export type UserRole = "admin" | "super_admin" | "hod" | "officer" | "cadet";

export interface RoleAssignment { role: UserRole; branch_code?: string | null }
export interface CurrentUser {
  id?: string;
  _id?: string;
  email?: string;
  username?: string;
  fullName?: string;
  full_name?: string;
  role?: UserRole;
  branch_code?: string | null;
  roles?: RoleAssignment[];
}

export interface Cadet {
  id: string;
  _id?: string;
  user_id?: string;
  roll?: string;
  cadet_code: string;
  full_name: string;
  name?: string;
  email?: string;
  branch?: string;
  course?: string;
  branch_code?: string | null;
  department?: string;
  semester?: string | number;
  year?: number;
  wing?: string;
  phone?: string;
  photo_url?: string | null;
  is_outside?: boolean;
  attendance_state?: string;
  face_enrolled?: boolean;
  fingerprint_enrolled?: boolean;
  fingerprint_enrolled_at?: string | null;
  fingerprint_last_verified_at?: string | null;
  fingerprint_verification_count?: number;
  nfc_card_id?: string | null;
  nfc_uid?: string | null;
  current_leave_id?: string | null;
  leave_blocked?: boolean;
  leave_blocked_reason?: string | null;
  leave_blocked_by?: string | null;
  leave_blocked_date?: string | null;
  leave_blocked_until?: string | null;
  leave_tokens?: number;
  max_leave_tokens?: number;
}

export interface LeaveRequest {
  id: string;
  _id?: string;
  roll?: string;
  cadet_id?: string;
  cadet?: Cadet;
  destination: string;
  reason?: string | null;
  start_at: string;
  end_at: string;
  created_at?: string;
  status: "pending" | "approved" | "rejected" | "expired" | "returned";
  me?: boolean;
}

export interface GateEvent {
  id: string;
  _id?: string;
  cadet?: Pick<Cadet, "id" | "full_name" | "cadet_code">;
  cadet_name?: string;
  roll_number?: string;
  direction: "entry" | "exit" | "CHECK_IN" | "CHECK_OUT";
  method?: "face" | "nfc" | "emergency" | "manual";
  occurred_at: string;
  gate_name?: string;
  result?: string;
  remarks?: string;
  nfc_uid?: string;
}
export interface AuditLog extends Partial<GateEvent> { id: string; occurred_at: string; action?: string; actor?: string; created_at?: string }

export interface GateActionResult {
  ok: boolean;
  cadet: { id: string; name: string };
  late?: boolean;
  at?: string;
}

export interface AdminSummary {
  totalCadets: number;
  outside: number;
  inside: number;
  pending: number;
  approvedToday: number;
  rejectedToday: number;
  gateEntries: number;
  gateExits: number;
  faceEnrolled: number;
  facePending: number;
  facePct: number;
  emergencyCodesToday: number;
  lateReturns: number;
  unknownNfc: number;
  denied: number;
  blockedCadets: number;
  blockedCadetPercentage: number;
}

export interface ReportSettings { run_time?: string; enabled?: boolean; recipients?: string[]; formats?: string[] }
export interface DailyReport { id: string; report_date: string; generated_at: string; delivery_status: string; storage_url?: string | null; error?: string | null }
export interface ReportGenerationResult { ok: boolean; signedUrl?: string; reportId?: string }
export interface ReturnMonitor { today: number; tomorrow: number; overdue: number; overdueList: LeaveRequest[] }
export interface BranchSummary { code: string; label: string; total: number; outside: number; pending: number; approved: number; compliance: number }
export interface NfcSummary { assigned: number; pending: number }
export interface LeaveStatusSummary { approved: number; pending: number; rejected: number; returned: number }
export interface MutationResult { ok?: boolean; success?: boolean; message?: string }
export interface NotificationRecord {
  notificationId: string;
  title: string;
  message: string;
  type: string;
  priority: "low" | "normal" | "high" | "urgent";
  createdAt: string;
  read: boolean;
  archived: boolean;
  userRole: string;
  actor?: string;
  entity?: Record<string, unknown>;
  url?: string;
}
export interface NotificationPage { notifications: NotificationRecord[]; unread: number; hasMore: boolean }
export interface CadetImportResult {
  success: boolean;
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  skippedRows: Array<{ row: number; roll: string; email: string; reason: string }>;
  failedRows: Array<{ row: number; roll: string; email: string; errors: string[] }>;
}

export interface ChartPoint { name: string; requested: number; approved: number; rejected: number; expired: number }
export interface DashboardStat { label: string; value: number; hint: string; icon: React.ComponentType<{ className?: string }>; tone?: string; delta?: string; suffix?: string }
