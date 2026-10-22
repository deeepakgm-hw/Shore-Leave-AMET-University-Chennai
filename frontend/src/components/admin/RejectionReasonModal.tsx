import React, { useState, useEffect } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";

export interface RejectionReasonModalProps {
  open: boolean;
  onClose: () => void;
  cadetName: string;
  roll: string;
  leaveType?: string;
  onConfirm: (reason: string) => Promise<void> | void;
  isPending?: boolean;
}

export function RejectionReasonModal({
  open,
  onClose,
  cadetName,
  roll,
  leaveType = "Shore Leave",
  onConfirm,
  isPending = false,
}: RejectionReasonModalProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("A rejection reason is mandatory. Whitespace-only input is not accepted.");
      return;
    }
    if (trimmed.length < 5) {
      setError("Please provide a meaningful reason (at least 5 characters).");
      return;
    }
    setError(null);
    onConfirm(trimmed);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rejection-modal-title"
      className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={() => {
        if (!isPending) onClose();
      }}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h3 id="rejection-modal-title" className="text-lg font-semibold text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Reject Shore Leave Request
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              This action will mark the request as rejected, notify the cadet, and restore any reserved leave tokens.
            </p>
          </div>
          <button
            type="button"
            disabled={isPending}
            onClick={onClose}
            aria-label="Close dialog"
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="my-4 rounded-xl border border-border bg-secondary/30 p-3.5 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-muted-foreground font-medium">Cadet Name:</span>
            <span className="font-semibold text-foreground">{cadetName || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground font-medium">Roll Number:</span>
            <span className="font-mono font-medium text-foreground">{roll}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground font-medium">Leave Category:</span>
            <span className="font-medium text-foreground">{leaveType}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="rejection-reason" className="block text-xs font-semibold text-foreground mb-1.5">
              Rejection Reason <span className="text-destructive">*</span>
            </label>
            <textarea
              id="rejection-reason"
              rows={4}
              disabled={isPending}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error && e.target.value.trim().length >= 5) {
                  setError(null);
                }
              }}
              placeholder="State the specific reason for rejecting this leave request (e.g. Disciplinary hold, inadequate documentation, duty roster clash, etc.)..."
              className={`w-full rounded-xl border p-3 text-xs leading-relaxed transition-colors outline-none focus:ring-2 ${
                error
                  ? "border-destructive focus:ring-destructive/30 bg-destructive/5"
                  : "border-border bg-background focus:ring-primary/30"
              }`}
            />
            {error && (
              <p className="mt-1.5 text-xs font-medium text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border">
            <button
              type="button"
              disabled={isPending}
              onClick={onClose}
              className="rounded-full border border-border px-4 py-2 text-xs font-medium hover:bg-secondary transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !reason.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-destructive px-5 py-2 text-xs font-semibold text-destructive-foreground shadow-sm hover:bg-destructive/90 transition-all disabled:opacity-40"
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isPending ? "Rejecting..." : "Confirm Rejection"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
