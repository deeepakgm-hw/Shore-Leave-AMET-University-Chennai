import React from "react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  MapPin,
  ShieldAlert,
  User,
  X,
} from "lucide-react";
import type { LeaveRequest } from "@/types";

export interface LeaveDetailsModalProps {
  open: boolean;
  onClose: () => void;
  request: LeaveRequest | null;
  onApprove?: (roll: string) => void;
  onReject?: (request: LeaveRequest) => void;
  isDeciding?: boolean;
}

export function LeaveDetailsModal({
  open,
  onClose,
  request,
  onApprove,
  onReject,
  isDeciding = false,
}: LeaveDetailsModalProps) {
  if (!open || !request) return null;

  const cadet = request.cadet;
  const roll = request.roll || cadet?.roll || cadet?.cadet_code || "—";
  const fullName = cadet?.full_name || cadet?.name || "Cadet";
  const branch = cadet?.branch || cadet?.branch_code || cadet?.department || "—";
  const course = cadet?.course || branch;

  const startDate = new Date(request.start_at);
  const endDate = new Date(request.end_at);
  const isValidStart = !Number.isNaN(startDate.getTime());
  const isValidEnd = !Number.isNaN(endDate.getTime());

  const durationHours = isValidStart && isValidEnd
    ? Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)))
    : null;

  const docUrl = request.documentUrl || request.supportingDocument?.publicUrl || request.supportingDocument?.url;
  const docName = request.supportingDocument?.fileName || "Supporting Document";

  const isPending = request.status === "pending";
  const isApproved = request.status === "approved";
  const isRejected = request.status === "rejected";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="leave-details-title"
      className="fixed inset-0 z-[65] grid place-items-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h2 id="leave-details-title" className="text-lg font-semibold tracking-tight text-foreground">
                Shore Leave Request Details
              </h2>
              <p className="text-xs text-muted-foreground">
                Request ID: <span className="font-mono">{request.id}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Status Pill & Rejection / Approval Banner */}
        <div className="my-4">
          {isRejected && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-xs">
              <div className="flex items-center gap-2 font-semibold text-destructive">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>Leave Request Rejected</span>
              </div>
              <div className="mt-2.5 rounded-lg border border-destructive/20 bg-background/80 p-3">
                <div className="font-semibold text-destructive">Rejection Reason:</div>
                <div className="mt-1 text-foreground leading-relaxed">
                  "{request.rejectionReason || "No specific reason provided."}"
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
                {request.reviewedBy && (
                  <div>
                    <span className="font-medium">Reviewed By:</span> {request.reviewedBy}{" "}
                    {request.reviewedByRole ? `(${request.reviewedByRole})` : ""}
                  </div>
                )}
                {request.reviewedAt && (
                  <div>
                    <span className="font-medium">Reviewed On:</span>{" "}
                    {new Date(request.reviewedAt).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          )}

          {isApproved && (
            <div className="rounded-xl border border-success/30 bg-success/10 p-4 text-xs">
              <div className="flex items-center gap-2 font-semibold text-success">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Leave Request Approved</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
                {request.reviewedBy && (
                  <div>
                    <span className="font-medium">Approved By:</span> {request.reviewedBy}
                  </div>
                )}
                {request.reviewedAt && (
                  <div>
                    <span className="font-medium">Approved On:</span>{" "}
                    {new Date(request.reviewedAt).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          )}

          {isPending && (
            <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
              <div className="flex items-center gap-2 font-medium">
                <Clock className="h-4 w-4 shrink-0 text-amber-600" />
                <span>Awaiting Review & Approval by Authority</span>
              </div>
              <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                Action Required
              </span>
            </div>
          )}
        </div>

        {/* Section 1: Cadet Information */}
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" /> Cadet Profile
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 rounded-xl border border-border bg-secondary/20 p-3.5 text-xs">
            <div>
              <span className="text-muted-foreground block text-[11px]">Full Name</span>
              <span className="font-semibold text-foreground text-sm">{fullName}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[11px]">Roll Number</span>
              <span className="font-mono font-bold text-foreground">{roll}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[11px]">Department / Branch</span>
              <span className="font-medium text-foreground">{branch}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[11px]">Course</span>
              <span className="font-medium text-foreground">{course}</span>
            </div>
            {cadet?.phone && (
              <div>
                <span className="text-muted-foreground block text-[11px]">Contact Number</span>
                <span className="font-medium text-foreground">{cadet.phone}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground block text-[11px]">Current Status</span>
              <span className="inline-block rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-foreground">
                {cadet?.is_outside ? "Outside Campus" : "Inside Campus"}
              </span>
            </div>
          </div>
        </section>

        {/* Section 2: Leave Request Details */}
        <section className="mt-4 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" /> Leave Schedule & Reason
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 rounded-xl border border-border bg-secondary/20 p-3.5 text-xs">
            <div>
              <span className="text-muted-foreground block text-[11px]">Leave Type</span>
              <span className="inline-block font-semibold text-primary rounded-md bg-primary/10 px-2 py-0.5 mt-0.5">
                {request.leaveType || request.reason || "Shore Leave"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[11px]">Destination</span>
              <span className="font-medium text-foreground flex items-center gap-1 mt-0.5">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                {request.destination || "—"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[11px]">Departure Window</span>
              <span className="font-medium text-foreground">
                {isValidStart ? startDate.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[11px]">Expected Return</span>
              <span className="font-medium text-foreground">
                {request.returnDate
                  ? new Date(request.returnDate).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
                  : isValidEnd
                    ? endDate.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
                    : "—"}
              </span>
            </div>
            {durationHours && (
              <div>
                <span className="text-muted-foreground block text-[11px]">Estimated Duration</span>
                <span className="font-medium text-foreground">~{durationHours} hours</span>
              </div>
            )}
            {request.created_at && (
              <div>
                <span className="text-muted-foreground block text-[11px]">Submitted At</span>
                <span className="font-medium text-foreground">
                  {new Date(request.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </div>
            )}
            <div className="sm:col-span-2 mt-1">
              <span className="text-muted-foreground block text-[11px]">Student Reason</span>
              <div className="mt-1 rounded-lg border border-border bg-background p-2.5 text-xs text-foreground leading-relaxed">
                {request.leaveReason || request.reason || "No explicit reason specified."}
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: Supporting Documents */}
        <section className="mt-4 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Download className="h-3.5 w-3.5" /> Supporting Document
          </h3>
          {docUrl ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText className="h-5 w-5 text-primary shrink-0" />
                <div className="truncate">
                  <p className="font-semibold text-foreground truncate">{docName}</p>
                  <p className="text-[11px] text-muted-foreground">Uploaded with leave application</p>
                </div>
              </div>
              <a
                href={docUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors shrink-0"
              >
                <span>View Document</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              No supporting document attached to this request.
            </div>
          )}
        </section>

        {/* Footer Actions */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border px-4 py-2 text-xs font-medium hover:bg-secondary transition-colors"
          >
            Close
          </button>

          {isPending && onApprove && onReject && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isDeciding}
                onClick={() => onReject(request)}
                className="rounded-full border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
              >
                Reject Request
              </button>
              <button
                type="button"
                disabled={isDeciding}
                onClick={() => onApprove(roll)}
                className="rounded-full bg-success px-5 py-2 text-xs font-semibold text-success-foreground shadow hover:bg-success/90 transition-colors disabled:opacity-50"
              >
                Approve Request
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
