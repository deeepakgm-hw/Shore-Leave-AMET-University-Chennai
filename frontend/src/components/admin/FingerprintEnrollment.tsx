import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Fingerprint,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Usb,
  UserRound,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { apiRequest } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import { queryKeys } from "@/api/query-keys";
import { getCurrentUser } from "@/api/auth";
import { fetchAdminCadets } from "@/lib/admin-queries";
import { getErrorMessage } from "@/lib/errors";

type DeviceStatus = {
  success: boolean;
  connected: boolean;
  configured: boolean;
  deviceModel: string;
  serialNumber: string | null;
  sdkVersion: string | null;
  checkedAt: string | null;
  code: string;
};

type FingerprintSummary = {
  success: boolean;
  totalCadets: number;
  enrolled: number;
  pending: number;
  verifiedToday: number;
  failedToday: number;
  faceFallbackToday: number;
  emergencyVerificationToday: number;
};

type FingerprintStatus = {
  success: boolean;
  cadetId: string;
  roll: string;
  name: string;
  enrolled: boolean;
  status: "ENROLLED" | "NOT_ENROLLED";
  enrolledAt: string | null;
  updatedAt: string | null;
  enrolledBy: string | null;
  deviceModel: string | null;
  deviceSerial: string | null;
  sdkVersion: string | null;
  verificationCount: number;
  lastVerifiedAt: string | null;
};

type CaptureStage = "IDLE" | "CAPTURING" | "PROCESSING" | "SAVING" | "SUCCESS";

const stageCopy: Record<CaptureStage, string> = {
  IDLE: "Ready to capture",
  CAPTURING: "Place finger on scanner...",
  PROCESSING: "Processing fingerprint...",
  SAVING: "Encrypting and saving template...",
  SUCCESS: "Enrollment successful",
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "C";
}

export function FingerprintEnrollment() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [stage, setStage] = useState<CaptureStage>("IDLE");

  const { data: currentUser } = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: getCurrentUser,
    staleTime: 60_000,
  });
  const roles = currentUser?.roles?.map((entry) => entry.role)
    ?? (currentUser?.role ? [currentUser.role] : []);
  const isAdmin = roles.some((role) => role === "admin" || role === "super_admin");

  const cadetsQuery = useQuery({
    queryKey: queryKeys.admin.fingerprintCadets,
    queryFn: () => fetchAdminCadets(),
  });
  const deviceQuery = useQuery({
    queryKey: queryKeys.admin.fingerprintDevice,
    queryFn: () => apiRequest<DeviceStatus>(endpoints.fingerprint.deviceStatus),
    refetchInterval: 10_000,
    retry: 1,
  });
  const summaryQuery = useQuery({
    queryKey: queryKeys.admin.fingerprintSummary,
    queryFn: () => apiRequest<FingerprintSummary>(endpoints.fingerprint.summary),
    refetchInterval: 30_000,
  });

  const cadets = cadetsQuery.data ?? [];
  const filteredCadets = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return cadets;
    return cadets.filter((cadet) =>
      [cadet.full_name, cadet.roll, cadet.cadet_code, cadet.email, cadet.department]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [cadets, search]);
  const selectedCadet = cadets.find((cadet) => cadet.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && filteredCadets.length) setSelectedId(filteredCadets[0].id);
    if (selectedId && !cadets.some((cadet) => cadet.id === selectedId)) setSelectedId("");
  }, [cadets, filteredCadets, selectedId]);

  const statusQuery = useQuery({
    queryKey: queryKeys.admin.fingerprintStatus(selectedCadet?.cadet_code),
    queryFn: () => apiRequest<FingerprintStatus>(
      endpoints.fingerprint.status(selectedCadet?.cadet_code || "")
    ),
    enabled: Boolean(selectedCadet?.cadet_code),
  });
  const status = statusQuery.data;

  const refreshFingerprintData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.fingerprintCadets }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.fingerprintSummary }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.fingerprintStatus(selectedCadet?.cadet_code) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.cadets }),
    ]);
  };

  const enrollment = useMutation({
    mutationFn: async (reenroll: boolean) => {
      if (!selectedCadet) throw new Error("Select a cadet before capturing a fingerprint.");
      if (!deviceQuery.data?.connected) throw new Error("Connect the Mantra MFS110 scanner before capture.");
      setStage("CAPTURING");
      const timer = window.setTimeout(() => setStage("PROCESSING"), 900);
      try {
        const result = reenroll
          ? await apiRequest<FingerprintStatus>(
              endpoints.fingerprint.reenroll(selectedCadet.cadet_code),
              { method: "PUT" }
            )
          : await apiRequest<FingerprintStatus>(
              endpoints.fingerprint.enroll,
              {
                method: "POST",
                body: JSON.stringify({ cadetId: selectedCadet.cadet_code }),
              }
            );
        setStage("SAVING");
        return result;
      } finally {
        window.clearTimeout(timer);
      }
    },
    onSuccess: async (result) => {
      setStage("SUCCESS");
      toast.success(`Fingerprint enrolled for ${result.name}.`);
      await refreshFingerprintData();
      window.setTimeout(() => setStage("IDLE"), 1_800);
    },
    onError: (error: unknown) => {
      setStage("IDLE");
      toast.error(getErrorMessage(error, "Fingerprint enrollment failed."));
    },
  });

  const removeEnrollment = useMutation({
    mutationFn: async () => {
      if (!selectedCadet) throw new Error("Select a cadet first.");
      return apiRequest<FingerprintStatus>(
        endpoints.fingerprint.remove(selectedCadet.cadet_code),
        { method: "DELETE" }
      );
    },
    onSuccess: async () => {
      toast.success("Fingerprint enrollment removed.");
      await refreshFingerprintData();
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Could not remove fingerprint enrollment.")),
  });

  const busy = enrollment.isPending || removeEnrollment.isPending;
  const summary = summaryQuery.data;

  return (
    <section aria-labelledby="fingerprint-enrollment-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg">
              <Fingerprint className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <h1 id="fingerprint-enrollment-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Fingerprint Enrollment
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Secure Mantra MFS110 enrollment with server-side template protection
              </p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void Promise.all([deviceQuery.refetch(), summaryQuery.refetch(), cadetsQuery.refetch()])}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold hover:bg-secondary"
        >
          <RefreshCw className={`h-4 w-4 ${deviceQuery.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Enrolled", summary?.enrolled ?? 0],
          ["Pending", summary?.pending ?? 0],
          ["Verified today", summary?.verifiedToday ?? 0],
          ["Failed today", summary?.failedToday ?? 0],
          ["Face fallbacks", summary?.faceFallbackToday ?? 0],
          ["Emergency checks", summary?.emergencyVerificationToday ?? 0],
          ["Coverage", summary?.totalCadets ? `${Math.round(((summary.enrolled || 0) / summary.totalCadets) * 100)}%` : "0%"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-border bg-card/60 p-4 backdrop-blur-md">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-md"
        >
          <div className="border-b border-border p-5">
            <h2 className="font-semibold">Select cadet</h2>
            <label className="relative mt-3 block">
              <span className="sr-only">Search cadets</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, roll or email"
                className="min-h-11 w-full rounded-xl border border-border bg-background pl-11 pr-4 text-sm outline-none focus:border-primary"
              />
            </label>
          </div>
          <div className="max-h-[560px] overflow-y-auto p-2">
            {cadetsQuery.isLoading && (
              <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading cadets...
              </div>
            )}
            {!cadetsQuery.isLoading && filteredCadets.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">No cadets match this search.</p>
            )}
            {filteredCadets.map((cadet) => {
              const selected = cadet.id === selectedId;
              return (
                <button
                  key={cadet.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(cadet.id);
                    setStage("IDLE");
                  }}
                  className={`mb-1 flex min-h-16 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
                    selected
                      ? "border-primary/40 bg-primary/10"
                      : "border-transparent hover:border-border hover:bg-secondary/50"
                  }`}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">
                    {initials(cadet.full_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{cadet.full_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{cadet.cadet_code}</span>
                  </span>
                  {cadet.fingerprint_enrolled
                    ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-label="Enrolled" />
                    : <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-warning" aria-label="Pending" />}
                </button>
              );
            })}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="space-y-5"
        >
          <div className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className={`grid h-11 w-11 place-items-center rounded-xl ${
                  deviceQuery.data?.connected ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                }`}>
                  <Usb className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="font-semibold">Fingerprint device</h2>
                  <p className="text-sm text-muted-foreground">
                    {deviceQuery.data?.connected ? "Connected" : "Offline"}
                  </p>
                </div>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                deviceQuery.data?.connected
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}>
                {deviceQuery.data?.connected ? "Online" : "Unavailable"}
              </span>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Device</dt><dd className="mt-1 font-medium">{deviceQuery.data?.deviceModel || "Mantra MFS110"}</dd></div>
              <div><dt className="text-muted-foreground">Serial number</dt><dd className="mt-1 font-medium">{deviceQuery.data?.serialNumber || "—"}</dd></div>
              <div><dt className="text-muted-foreground">SDK version</dt><dd className="mt-1 font-medium">{deviceQuery.data?.sdkVersion || "—"}</dd></div>
            </dl>
            {!deviceQuery.data?.configured && (
              <p className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                Configure the backend Mantra bridge before enrollment. The browser never accesses the USB device directly.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-md">
            {!selectedCadet ? (
              <div className="grid min-h-64 place-items-center text-center">
                <div>
                  <UserRound className="mx-auto h-9 w-9 text-muted-foreground" />
                  <p className="mt-3 font-medium">Select a cadet to begin</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 text-lg font-semibold">
                    {initials(selectedCadet.full_name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-xl font-semibold">{selectedCadet.full_name}</h2>
                    <p className="truncate text-sm text-muted-foreground">{selectedCadet.cadet_code}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    status?.enrolled
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-warning/30 bg-warning/10 text-warning"
                  }`}>
                    {status?.enrolled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    {status?.enrolled ? "Enrolled" : "Not enrolled"}
                  </span>
                </div>

                <dl className="mt-5 grid gap-3 rounded-2xl border border-border bg-secondary/30 p-4 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Application number</dt><dd className="mt-1 font-medium">{selectedCadet.cadet_code}</dd></div>
                  <div><dt className="text-muted-foreground">Course / department</dt><dd className="mt-1 font-medium">{selectedCadet.department || selectedCadet.branch || "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Email</dt><dd className="mt-1 truncate font-medium">{selectedCadet.email || "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Contact</dt><dd className="mt-1 font-medium">{selectedCadet.phone || "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Enrolled at</dt><dd className="mt-1 font-medium">{formatDate(status?.enrolledAt)}</dd></div>
                  <div><dt className="text-muted-foreground">Officer</dt><dd className="mt-1 font-medium">{status?.enrolledBy || "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Device</dt><dd className="mt-1 font-medium">{status?.deviceModel || "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Verifications</dt><dd className="mt-1 font-medium">{status?.verificationCount ?? 0}</dd></div>
                </dl>

                <div className="mt-5 rounded-2xl border border-border bg-background/70 p-5">
                  <div className="flex items-center gap-3">
                    <span className={`grid h-12 w-12 place-items-center rounded-full ${
                      stage === "SUCCESS" ? "bg-success/10 text-success" : "bg-primary/10 text-primary"
                    }`}>
                      {busy
                        ? <Loader2 className="h-6 w-6 animate-spin" />
                        : stage === "SUCCESS"
                          ? <ShieldCheck className="h-6 w-6" />
                          : <Fingerprint className="h-6 w-6" />}
                    </span>
                    <div className="flex-1">
                      <p className="font-semibold">{stageCopy[stage]}</p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                        <motion.div
                          className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                          animate={{ width: stage === "IDLE" ? "0%" : stage === "CAPTURING" ? "35%" : stage === "PROCESSING" ? "65%" : stage === "SAVING" ? "88%" : "100%" }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  {!status?.enrolled && (
                    <button
                      type="button"
                      disabled={busy || !deviceQuery.data?.connected}
                      onClick={() => enrollment.mutate(false)}
                      className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-primary to-accent px-5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Fingerprint className="h-4 w-4" /> Capture fingerprint
                    </button>
                  )}
                  {status?.enrolled && isAdmin && (
                    <button
                      type="button"
                      disabled={busy || !deviceQuery.data?.connected}
                      onClick={() => enrollment.mutate(true)}
                      className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-primary to-accent px-5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className="h-4 w-4" /> Re-enroll fingerprint
                    </button>
                  )}
                  {status?.enrolled && isAdmin && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Remove fingerprint enrollment for ${selectedCadet.full_name}?`)) {
                          removeEnrollment.mutate();
                        }
                      }}
                      className="min-h-11 rounded-full border border-destructive/30 px-5 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {status?.enrolled && !isAdmin && (
                  <p className="mt-3 text-xs text-muted-foreground">Only an administrator can replace an existing fingerprint.</p>
                )}
              </>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
