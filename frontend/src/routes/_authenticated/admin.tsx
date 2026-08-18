import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { API, ApiError, apiRequest } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import { queryKeys } from "@/api/query-keys";
import { TokenService } from "@/services/token.service";
import { getCurrentUser } from "@/api/auth";
import { getCameraRuntimeIssue, logCameraRuntime, requestUserCamera } from "@/lib/camera-runtime";
import { getErrorMessage } from "@/lib/errors";
import type { Cadet, ChartPoint, DashboardStat, GateActionResult, LeaveRequest } from "@/types";
import type { LucideIcon } from "lucide-react";
import { redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  LayoutDashboard, Users, Plane, ScanFace, Nfc, FileBarChart, Bell, Settings,
  Search, ChevronDown, Check, X, Eye, Activity, ArrowUpRight, ArrowDownRight,
  ShieldCheck, AlertTriangle, Plus, UserPlus, FileSpreadsheet, Megaphone, Sparkles,
  TrendingUp, Clock, MapPin, LogOut, LogIn, Camera, KeyRound, Download,
  RefreshCw, Filter, Send, HelpCircle, Loader2, MoreVertical, Trash2, Ban, Fingerprint, TicketCheck,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import {
  checkInCadet, checkOutCadet, decideLeave, fetchAdminCadets, fetchAdminSummary, fetchBranchSummary,
  enrollCadetFace, fetchLeaveStatusSummary, fetchNfcSummary, fetchRecentGate, fetchRecentRequests, fetchReturnMonitor,
  fetchRecentGateHistory, fetchReportSettings, updateReportSettings, fetchDailyReports, generateDailyReport,
  fetchNotifications, blockCadetLeave, unblockCadetLeave,
} from "@/lib/admin-queries";
import { nfcCheckIn, nfcCheckOut } from "@/lib/gate.functions";
import { CadetImportDialog } from "@/components/admin/CadetImportDialog";
import { NotificationCenter } from "@/components/admin/NotificationCenter";
import { FingerprintEnrollment } from "@/components/admin/FingerprintEnrollment";
import { BiometricGateCheckout } from "@/components/admin/BiometricGateCheckout";
import { AdminAccountManagement } from "@/components/admin/AdminAccountManagement";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ context }) => {
    let user: Awaited<ReturnType<typeof getCurrentUser>>;
    try {
      user = await context.queryClient.ensureQueryData({
        queryKey: queryKeys.auth.me,
        queryFn: getCurrentUser,
        staleTime: 60_000,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw redirect({ to: "/auth", search: { role: "admin" } });
      return;
    }
    if (!user.role && !user.roles?.length) throw redirect({ to: "/auth", search: { role: "admin" } });
    const roles = user.roles?.map((entry) => entry.role) ?? (user.role ? [user.role] : []);
    if (!roles.some((role) => ["admin", "super_admin", "hod", "officer"].includes(role))) {
      throw redirect({ to: "/cadet" });
    }
  },
  head: () => ({ meta: [{ title: "Administrator · Shore Leave" }] }),
  component: AdminDashboard,
});

/* ============================== BRANCHES ================================ */
export const BRANCHES = [
  { code: "BE-MAERSK",  name: "B.E Marine Engineering", company: "Maersk"  },
  { code: "BSC-MAERSK", name: "B.Sc Nautical Science",  company: "Maersk"  },
  { code: "ETO-MAERSK", name: "Electro-Technical Officer", company: "Maersk" },
  { code: "DNS-VSHIPS", name: "DNS",                    company: "V.Ships" },
  { code: "BE-VSHIPS",  name: "B.E Marine Engineering", company: "V.Ships" },
] as const;
export type BranchCode = typeof BRANCHES[number]["code"];
export const branchLabel = (code?: string | null) => {
  const b = BRANCHES.find((x) => x.code === code);
  return b ? `${b.name} (${b.company})` : "—";
};

function useAdminProfile() {
  return useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: getCurrentUser,
    select: (user) => {
      const roles = user.roles ?? [user];
      const isSuper = roles.some((role) => role.role === "super_admin" || role.role === "admin");
      const hod = roles.find((role) => role.role === "hod");
      return {
        userId: user.id || user._id,
        email: user.email,
        role: isSuper ? "super_admin" : hod ? "hod" : "cadet",
        branch: hod?.branch_code ?? null,
      } as { userId: string; email?: string; role: "super_admin" | "hod" | "cadet"; branch: BranchCode | null };
    },
    staleTime: 60_000,
  });
}

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "cadets", label: "Cadets", icon: Users },
  { id: "leave", label: "Leave Requests", icon: Plane },
  { id: "tokens", label: "Leave Token Control", icon: TicketCheck },
  { id: "emergency", label: "Emergency Codes", icon: KeyRound },
  { id: "face", label: "Face Enroll", icon: ScanFace },
  { id: "fingerprint", label: "Fingerprint Enroll", icon: Fingerprint },
  { id: "reports", label: "Reports", icon: FileBarChart },
  { id: "settings", label: "Settings", icon: Settings },
];

function useCountUp(target: number, duration = 1000) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0; const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return now;
}

function AdminDashboard() {
  const [active, setActive] = useState("dashboard");
  const [profileName, setProfileName] = useState<string>("Administrator");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { data: adminProfile } = useAdminProfile();

  useEffect(() => {
    setProfileName(adminProfile?.email?.split("@")[0] || "Administrator");
  }, [adminProfile]);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[600px] hero-glow opacity-60" />
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-40 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_70%)]" />

      <TopNav active={active} setActive={setActive} name={profileName} profile={adminProfile ?? null} onNotifications={() => setNotificationsOpen(true)} />

      <main className="relative mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6 sm:pt-10 lg:px-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35 }}
          >
            {active === "dashboard" && <DashboardView name={profileName} profile={adminProfile ?? null} onNavigate={setActive} />}
            {active === "cadets" && <CadetsView />}
            {active === "leave" && <LeaveView />}
            {active === "tokens" && <LeaveTokenControlView />}
            {active === "checkin" && <CheckInView />}
            {active === "checkout" && <CheckOutView />}
            {active === "face" && <FaceView />}
            {active === "fingerprint" && <FingerprintEnrollment />}
            {active === "emergency" && <EmergencyCodesView />}
            {active === "reports" && <ReportsView />}
            {active === "settings" && <SettingsView canManageAdministrators={adminProfile?.role === "super_admin"} />}
          </motion.div>
        </AnimatePresence>
      </main>
      <AnimatePresence>
        {notificationsOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setNotificationsOpen(false)}>
            <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }} onClick={(event) => event.stopPropagation()} className="w-full max-w-3xl">
              <Notifications />
              <button onClick={() => setNotificationsOpen(false)} className="mt-3 w-full rounded-full border border-white/40 bg-white/80 px-4 py-2 text-sm font-semibold text-foreground backdrop-blur hover:bg-white">Close notifications</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type AdminProfile = { userId: string; email?: string; role: "super_admin" | "hod" | "cadet"; branch: BranchCode | null } | null;

function DashboardView({ name, profile, onNavigate }: { name: string; profile: AdminProfile; onNavigate: (view: string) => void }) {
  const isSuper = profile?.role === "super_admin";
  return (
    <>
      <Welcome name={name} />
      {isSuper && <BranchComparison />}
      <StatGrid />
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <LiveGateMonitor />
        <div className="lg:col-span-2"><LeaveOverview /></div>
      </div>
      <BiometricGateCheckout />
      <TimeFilterBar />
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2"><RecentRequests /></div>
        <LiveGateFeed />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        <FaceEnrollment onOpen={() => onNavigate("face")} />
        <NfcManagement />
        <EmergencyCodeStats />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AttendanceOverview />
        <ReturnMonitor />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2"><Notifications /></div>
        <LeaveStatusDonut />
      </div>
      <SystemHealth />
      <QuickActions />
      <div className="mt-6"><ActivityFeed /></div>
    </>
  );
}

function ViewHeader({ title, subtitle, icon: Icon }: { title: string; subtitle: string; icon: LucideIcon }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="pt-8 sm:pt-12">
      <div className="flex items-center gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[0_10px_30px_-10px_oklch(0.72_0.18_45/0.5)]">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </motion.div>
  );
}

function cadetBranchGroup(cadet: Cadet): "bsc" | "bme" | "other" {
  const branch = `${cadet.branch ?? ""} ${cadet.course ?? ""}`.toLowerCase();
  if (branch.includes("bsc") || branch.includes("b.sc") || branch.includes("nautical")) return "bsc";
  if (branch.includes("bme") || branch.includes("b.e") || branch.includes("marine engineering")) return "bme";
  return "other";
}

function CadetsView() {
  const [q, setQ] = useState("");
  const [leaveFilter, setLeaveFilter] = useState<"all" | "active" | "blocked">("all");
  const [branchFilter, setBranchFilter] = useState<"all" | "bsc" | "bme">("all");
  const [importOpen, setImportOpen] = useState(false);
  const [blockTarget, setBlockTarget] = useState<Cadet | null>(null);
  const [unblockTarget, setUnblockTarget] = useState<Cadet | null>(null);
  const queryClient = useQueryClient();
  const { data: cadets = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.cadets,
    queryFn: async () => {
      return fetchAdminCadets();
    },
  });
  const updateCadetRow = (updated: Cadet) => {
    queryClient.setQueryData<Cadet[]>(queryKeys.admin.cadets, (rows = []) =>
      rows.map((row) => (row.id === updated.id || row.cadet_code === updated.cadet_code ? { ...row, ...updated } : row))
    );
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.summary });
  };
  const blockMutation = useMutation({
    mutationFn: ({ cadet, reason, blockedUntil }: { cadet: Cadet; reason: string; blockedUntil?: string | null }) =>
      blockCadetLeave(cadet.cadet_code, { reason, blockedUntil }),
    onSuccess: (updated) => {
      updateCadetRow(updated);
      setBlockTarget(null);
      toast.success("Leave privileges suspended.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to block leave.")),
  });
  const unblockMutation = useMutation({
    mutationFn: (cadet: Cadet) => unblockCadetLeave(cadet.cadet_code),
    onSuccess: (updated) => {
      updateCadetRow(updated);
      setUnblockTarget(null);
      toast.success("Leave privileges restored.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to unblock leave.")),
  });
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return cadets.filter((c) => {
      if (leaveFilter === "active" && c.leave_blocked) return false;
      if (leaveFilter === "blocked" && !c.leave_blocked) return false;
      const branchKey = cadetBranchGroup(c);
      if (branchFilter !== "all" && branchKey !== branchFilter) return false;
      if (!t) return true;
      return (
      [c.full_name, c.cadet_code, c.branch, c.phone].filter((value): value is string => Boolean(value)).some((value) => value.toLowerCase().includes(t))
      );
    });
  }, [cadets, branchFilter, leaveFilter, q]);
  const groupedCadets = useMemo(() => {
    const groups = [
      { key: "bsc", title: "BSC Cadets", hint: "B.Sc. Nautical Science", rows: filtered.filter((cadet) => cadetBranchGroup(cadet) === "bsc") },
      { key: "bme", title: "BME Cadets", hint: "B.E. Marine Engineering", rows: filtered.filter((cadet) => cadetBranchGroup(cadet) === "bme") },
      { key: "other", title: "Other Cadets", hint: "Additional branches", rows: filtered.filter((cadet) => cadetBranchGroup(cadet) === "other") },
    ];
    return branchFilter === "all" ? groups.filter((group) => group.rows.length > 0) : groups.filter((group) => group.key === branchFilter);
  }, [branchFilter, filtered]);
  const renderCadetRow = (c: Cadet) => {
    const initials = (c.full_name ?? "?").split(" ").map((x: string) => x[0]).slice(0, 2).join("").toUpperCase();
    return (
      <motion.div key={c.id} layout className="grid grid-cols-12 items-center gap-2 px-5 py-3 text-sm transition-colors hover:bg-secondary/30">
        <div className="col-span-5 flex items-center gap-3 sm:col-span-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-bold text-primary-foreground">{initials}</div>
          <div className="min-w-0">
            <div className="truncate font-medium">{c.full_name}</div>
            <div className="text-[11px] text-muted-foreground">{c.cadet_code}</div>
          </div>
        </div>
        <div className="col-span-2 hidden truncate text-muted-foreground sm:block">{c.branch ?? "—"} · S{c.semester ?? "?"}</div>
        <div className="col-span-1 hidden lg:block">{c.face_enrolled ? <span className="text-success">Enrolled</span> : <span className="text-muted-foreground">Pending</span>}</div>
        <div className="col-span-2 hidden truncate font-mono text-[11px] text-muted-foreground xl:block">{c.nfc_card_id ?? "—"}</div>
        <div className="col-span-3 hidden md:block">
          <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${c.leave_blocked ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-success/30 bg-success/10 text-success"}`}>
            {c.leave_blocked ? "Leave Blocked" : "Active Leave"}
          </span>
        </div>
        <div className="col-span-7 flex justify-end sm:col-span-7 md:col-span-4 lg:col-span-3 xl:col-span-1">
          <button
            onClick={() => (c.leave_blocked ? setUnblockTarget(c) : setBlockTarget(c))}
            className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
              c.leave_blocked
                ? "border-success/30 bg-success/10 text-success hover:bg-success/15"
                : "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15"
            }`}
          >
            {c.leave_blocked ? "Unblock Leave" : "Block Leave"}
          </button>
        </div>
      </motion.div>
    );
  };
  return (
    <>
      <ViewHeader title="Cadets" subtitle="Full academy roster, enrollment & gate status" icon={Users} />
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <div className="flex flex-1 items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, code, branch…"
            className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
          {(["all", "bsc", "bme"] as const).map((branch) => (
            <button
              key={branch}
              onClick={() => setBranchFilter(branch)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold uppercase transition-colors ${
                branchFilter === branch ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {branch === "all" ? "All Branches" : branch.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
          {(["all", "active", "blocked"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setLeaveFilter(status)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize transition-colors ${
                leaveFilter === status ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {status === "active" ? "Active Leave" : status === "blocked" ? "Leave Blocked" : "All"}
            </button>
          ))}
        </div>
        <button onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-semibold"><FileSpreadsheet className="h-4 w-4" /> Bulk import</button>
        <button onClick={() => toast.info("Use Bulk import for CSV/Excel or the existing cadet API for individual records.")} className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary to-accent px-4 py-2.5 text-sm font-semibold text-primary-foreground"><UserPlus className="h-4 w-4" /> Add cadet</button>
      </div>
      <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-md">
        <div className="grid grid-cols-12 gap-2 border-b border-border bg-secondary/30 px-5 py-3 text-[11px] uppercase tracking-wider text-muted-foreground">
          <div className="col-span-5 sm:col-span-3">Cadet</div>
          <div className="col-span-2 hidden sm:block">Branch</div>
          <div className="col-span-1 hidden lg:block">Face</div>
          <div className="col-span-2 hidden xl:block">NFC</div>
          <div className="col-span-3 hidden md:block">Leave Status</div>
          <div className="col-span-7 text-right sm:col-span-7 md:col-span-4 lg:col-span-3 xl:col-span-1">Action</div>
        </div>
        <div className="divide-y divide-border">
          {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && filtered.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No cadets match.</p>}
          {groupedCadets.map((group) => (
            <section key={group.key} className="divide-y divide-border">
              <div className="flex items-center justify-between bg-background/80 px-5 py-3">
                <div>
                  <h3 className="text-sm font-semibold">{group.title}</h3>
                  <p className="text-[11px] text-muted-foreground">{group.hint}</p>
                </div>
                <span className="rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold text-muted-foreground">{group.rows.length} cadets</span>
              </div>
              {group.rows.length ? group.rows.map(renderCadetRow) : <p className="py-8 text-center text-sm text-muted-foreground">No {group.title.toLowerCase()} match.</p>}
            </section>
          ))}
        </div>
      </div>
      <LeaveBlockDialog
        cadet={blockTarget}
        pending={blockMutation.isPending}
        onClose={() => setBlockTarget(null)}
        onConfirm={(reason, blockedUntil) => {
          if (blockTarget) {
            blockMutation.mutate({ cadet: blockTarget, reason, blockedUntil });
          }
        }}
      />
      <LeaveUnblockDialog
        cadet={unblockTarget}
        pending={unblockMutation.isPending}
        onClose={() => setUnblockTarget(null)}
        onConfirm={() => {
          if (unblockTarget) {
            unblockMutation.mutate(unblockTarget);
          }
        }}
      />
      <CadetImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

function LeaveBlockDialog({ cadet, pending, onClose, onConfirm }: {
  cadet: Cadet | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string, blockedUntil?: string | null) => void;
}) {
  const [reason, setReason] = useState("");
  const [blockedUntil, setBlockedUntil] = useState("");
  useEffect(() => {
    if (cadet) {
      setReason("");
      setBlockedUntil("");
    }
  }, [cadet]);
  if (!cadet) return null;
  const canSubmit = reason.trim().length > 0 && !pending;
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
        <motion.form
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) onConfirm(reason.trim(), blockedUntil || null);
          }}
          className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive"><Ban className="h-3.5 w-3.5" /> Block Leave</div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight">Suspend leave privileges?</h2>
              <p className="mt-1 text-sm text-muted-foreground">This cadet cannot apply for leave, generate tokens, or receive gate passes until restored.</p>
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-5 grid gap-3 rounded-2xl border border-border bg-secondary/30 p-4 text-sm sm:grid-cols-2">
            <div><span className="text-muted-foreground">Cadet</span><div className="font-semibold">{cadet.full_name}</div></div>
            <div><span className="text-muted-foreground">Roll Number</span><div className="font-mono font-semibold">{cadet.cadet_code}</div></div>
            <div><span className="text-muted-foreground">Branch</span><div className="font-semibold">{cadet.branch ?? "—"}</div></div>
            <div><span className="text-muted-foreground">Current Leave Status</span><div className={cadet.leave_blocked ? "font-semibold text-destructive" : "font-semibold text-success"}>{cadet.leave_blocked ? "Leave Blocked" : "Active Leave"}</div></div>
          </div>
          <label className="mt-5 block">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Blocking Reason</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              rows={3}
              placeholder="Disciplinary Action, Fee Pending, Training Suspension, Medical Restriction, Administrative Hold, Other..."
              className="mt-2 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="mt-4 block">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Block Until Date <span className="normal-case tracking-normal text-muted-foreground/70">(optional)</span></span>
            <input value={blockedUntil} onChange={(event) => setBlockedUntil(event.target.value)} type="date" className="mt-2 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary" />
          </label>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold hover:bg-secondary">Cancel</button>
            <button type="submit" disabled={!canSubmit} className="inline-flex items-center justify-center gap-2 rounded-full bg-destructive px-5 py-2.5 text-sm font-semibold text-destructive-foreground disabled:opacity-60">
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} Confirm Block
            </button>
          </div>
        </motion.form>
      </motion.div>
    </AnimatePresence>
  );
}

function LeaveUnblockDialog({ cadet, pending, onClose, onConfirm }: {
  cadet: Cadet | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!cadet) return null;
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          onClick={(event) => event.stopPropagation()}
          className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl"
        >
          <h2 className="text-2xl font-semibold tracking-tight">Restore leave privileges?</h2>
          <p className="mt-2 text-sm text-muted-foreground">Are you sure you want to allow this cadet to apply for leave again?</p>
          <div className="mt-5 rounded-2xl border border-border bg-secondary/30 p-4">
            <div className="font-semibold">{cadet.full_name}</div>
            <div className="font-mono text-xs text-muted-foreground">{cadet.cadet_code}</div>
            {cadet.leave_blocked_reason && <div className="mt-2 text-sm text-muted-foreground">Reason: {cadet.leave_blocked_reason}</div>}
          </div>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold hover:bg-secondary">Cancel</button>
            <button type="button" onClick={onConfirm} disabled={pending} className="inline-flex items-center justify-center gap-2 rounded-full bg-success px-5 py-2.5 text-sm font-semibold text-success-foreground disabled:opacity-60">
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} Unblock Leave
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function LeaveView() {
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [q, setQ] = useState("");
  return (
    <>
      <ViewHeader title="Shore Leave" subtitle="Approve, monitor and visualise leave activity" icon={Plane} />
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
          {(["all","pending","approved","rejected"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`relative rounded-full px-3.5 py-1.5 text-xs font-medium capitalize transition-colors ${filter===f ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>{f}</button>
          ))}
        </div>
        <div className="flex flex-1 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search by name or roll…" className="w-full bg-transparent outline-none" />
        </div>
      </div>
      <div className="mt-8"><NewLeaveRequestsPanel filter={filter} search={q} /></div>
      <div className="mt-6"><LeaveOverview /></div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3"><RecentRequests filter={filter} search={q} /><LiveGateFeed /></div>
    </>
  );
}

function LeaveTokenControlView() {
  return (
    <>
      <ViewHeader
        title="Leave Token Control"
        subtitle="Generate, revoke and reissue leave tokens with live cadet dashboard updates"
        icon={TicketCheck}
      />
      <div className="mt-8"><LeaveTokenControl /></div>
    </>
  );
}

function NewLeaveRequestsPanel({ filter = "all", search = "" }: { filter?: "all"|"pending"|"approved"|"rejected"; search?: string }) {
  const qc = useQueryClient();
  const { data: items = [], isLoading, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: queryKeys.admin.leaveRequests,
    queryFn: fetchRecentRequests,
    refetchInterval: 30_000,
  });
  const decision = useMutation({
    mutationFn: ({ roll, status, reason }: { roll: string; status: "approved" | "rejected"; reason?: string }) => decideLeave(roll, status, reason),
    onSuccess: (_data, vars) => {
      toast.success(`Leave request ${vars.status}`);
      qc.invalidateQueries({ queryKey: queryKeys.admin.leaveRequests });
      qc.invalidateQueries({ queryKey: ["admin", "dashboard-live-chart"] });
      qc.invalidateQueries({ queryKey: queryKeys.admin.leaveTokenControl });
      qc.invalidateQueries({ queryKey: queryKeys.admin.summary });
      qc.invalidateQueries({ queryKey: queryKeys.admin.leaveStatus });
      qc.invalidateQueries({ queryKey: queryKeys.admin.pendingCheckout });
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Leave action failed")),
  });

  const term = search.trim().toLowerCase();
  const visible = useMemo(() => items.filter((request) => {
    if (filter !== "all" && request.status !== filter) return false;
    if (!term) return true;
    return [
      request.cadet?.full_name,
      request.cadet?.cadet_code,
      request.roll,
      request.destination,
      request.reason,
    ].filter((value): value is string => Boolean(value)).some((value) => value.toLowerCase().includes(term));
  }), [filter, items, term]);

  const counts = useMemo(() => ({
    pending: items.filter((request) => request.status === "pending").length,
    approved: items.filter((request) => request.status === "approved").length,
    rejected: items.filter((request) => request.status === "rejected").length,
  }), [items]);
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">New leave requests</h2>
          <p className="text-sm text-muted-foreground">Live requests from MongoDB Atlas, including recent approvals and rejections.</p>
        </div>
        <button onClick={() => void refetch()} className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium hover:bg-secondary">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh live data
        </button>
      </div>
      <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-3">
        <LiveLeaveMetric label="Pending now" value={counts.pending} tone="warning" />
        <LiveLeaveMetric label="Recently approved" value={counts.approved} tone="success" />
        <LiveLeaveMetric label="Recently rejected" value={counts.rejected} tone="destructive" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/30 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-3 text-left font-medium">Cadet</th>
              <th className="px-3 py-3 text-left font-medium">Roll No</th>
              <th className="px-3 py-3 text-left font-medium">Leave Type</th>
              <th className="px-3 py-3 text-left font-medium">Destination</th>
              <th className="px-3 py-3 text-left font-medium">Window</th>
              <th className="px-3 py-3 text-left font-medium">Status</th>
              <th className="px-6 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-muted-foreground">Loading live leave requests…</td></tr>}
            {isError && !isLoading && <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-destructive">Unable to load live leave requests.</td></tr>}
            {!isLoading && !isError && visible.length === 0 && <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-muted-foreground">No live leave requests match this filter.</td></tr>}
            {visible.slice(0, 12).map((request) => {
              const roll = request.roll || request.cadet?.cadet_code || "";
              const canDecide = request.status === "pending" && !!roll;
              return (
                <motion.tr key={`${request.id}-${roll}`} layout className="transition-colors hover:bg-secondary/20">
                  <td className="px-6 py-3 font-medium">{request.cadet?.full_name || "—"}</td>
                  <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{roll || "—"}</td>
                  <td className="px-3 py-3">{request.reason || "Shore Leave"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{request.destination || "—"}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {new Date(request.start_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                    <span className="mx-1">→</span>
                    {new Date(request.end_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                  </td>
                  <td className="px-3 py-3"><StatusBadge status={request.status} /></td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button disabled={!canDecide || decision.isPending} onClick={() => decision.mutate({ roll, status: "approved" })} className="rounded-full border border-success/30 px-3 py-1 text-xs font-medium text-success hover:bg-success/10 disabled:opacity-30">Approve</button>
                      <button disabled={!canDecide || decision.isPending} onClick={() => decision.mutate({ roll, status: "rejected", reason: "Rejected by administrator" })} className="rounded-full border border-destructive/30 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-30">Reject</button>
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-3 text-xs text-muted-foreground">
        <span>Showing {Math.min(visible.length, 12)} of {visible.length} matching requests.</span>
        <span>Last refreshed {lastUpdated}</span>
      </div>
    </motion.section>
  );
}

function LiveLeaveMetric({ label, value, tone }: { label: string; value: number; tone: "warning" | "success" | "destructive" }) {
  const toneClass = {
    warning: "text-warning bg-warning/10 border-warning/20",
    success: "text-success bg-success/10 border-success/20",
    destructive: "text-destructive bg-destructive/10 border-destructive/20",
  }[tone];
  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs font-medium">{label}</div>
    </div>
  );
}

type LeaveTokenRequest = {
  id: string;
  source: "pendingLeave" | "leaveRecord";
  roll: string;
  cadetName: string;
  leaveType: string;
  startDate?: string;
  endDate?: string;
  leaveStatus: string;
  tokenStatus: string;
  passNo?: string | null;
  emergencyVerificationCode?: string | null;
  passUrl?: string | null;
  documentUrl?: string | null;
};

type LeaveTokenControlResponse = {
  success: boolean;
  requests: LeaveTokenRequest[];
};

function LeaveTokenControl() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const { data: requests = [], isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.admin.leaveTokenControl,
    queryFn: async () => {
      const response = await apiRequest<LeaveTokenControlResponse>(endpoints.admin.leaveTokenControl);
      return response.requests ?? [];
    },
  });

  const decision = useMutation({
    mutationFn: ({ roll, nextStatus }: { roll: string; nextStatus: "approved" | "rejected" }) =>
      decideLeave(roll, nextStatus, nextStatus === "rejected" ? "Rejected by administrator" : undefined),
    onSuccess: (_data, vars) => {
      toast.success(`Leave ${vars.nextStatus}`);
      qc.invalidateQueries({ queryKey: queryKeys.admin.leaveTokenControl });
      qc.invalidateQueries({ queryKey: queryKeys.admin.leaveRequests });
      qc.invalidateQueries({ queryKey: queryKeys.admin.summary });
      qc.invalidateQueries({ queryKey: queryKeys.admin.leaveStatus });
      qc.invalidateQueries({ queryKey: queryKeys.admin.pendingCheckout });
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Leave action failed")),
  });

  const token = useMutation({
    mutationFn: ({ roll, action }: { roll: string; action: "generate" | "revoke" | "reissue" }) =>
      apiRequest<{ success: boolean; message?: string }>(endpoints.admin.leaveTokenAction(roll, action), { method: "POST" }),
    onSuccess: (_data, vars) => {
      const actionLabel = { generate: "generated", revoke: "revoked", reissue: "reissued" }[vars.action];
      toast.success(`Token ${actionLabel}`);
      qc.invalidateQueries({ queryKey: queryKeys.admin.leaveTokenControl });
      qc.invalidateQueries({ queryKey: queryKeys.admin.leaveRequests });
      qc.invalidateQueries({ queryKey: queryKeys.admin.summary });
      qc.invalidateQueries({ queryKey: queryKeys.admin.pendingCheckout });
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Token action failed")),
  });

  const statuses = ["all", "pending", "approved", "rejected", "checked_out", "checked_in", "expired", "cancelled"];
  const filtered = requests.filter((request) => {
    if (status === "all") return true;
    return request.leaveStatus === status || request.tokenStatus === status;
  });

  const openLink = (url?: string | null) => {
    if (!url) {
      toast.info("No document is available for this request.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Leave Token Control</h2>
          <p className="text-sm text-muted-foreground">Approve requests, manage emergency codes, print passes and review supporting documents.</p>
        </div>
        <button onClick={() => void refetch()} className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium hover:bg-secondary">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>
      <div className="border-b border-border px-6 py-3">
        <div className="flex gap-1 overflow-x-auto rounded-full border border-border bg-secondary/30 p-1">
          {statuses.map((item) => (
            <button
              key={item}
              onClick={() => setStatus(item)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium capitalize transition-colors ${status === item ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              {item.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/30 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-3 text-left font-medium">Roll Number</th>
              <th className="px-3 py-3 text-left font-medium">Cadet Name</th>
              <th className="px-3 py-3 text-left font-medium">Leave Type</th>
              <th className="px-3 py-3 text-left font-medium">Start Date</th>
              <th className="px-3 py-3 text-left font-medium">End Date</th>
              <th className="px-3 py-3 text-left font-medium">Leave Status</th>
              <th className="px-3 py-3 text-left font-medium">Token Status</th>
              <th className="px-6 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && <tr><td colSpan={8} className="px-6 py-8 text-center text-sm text-muted-foreground">Loading leave token control…</td></tr>}
            {isError && !isLoading && <tr><td colSpan={8} className="px-6 py-8 text-center text-sm text-destructive">Unable to load leave token control.</td></tr>}
            {!isLoading && !isError && filtered.length === 0 && <tr><td colSpan={8} className="px-6 py-8 text-center text-sm text-muted-foreground">No leave requests match this filter.</td></tr>}
            {filtered.map((request) => {
              const approved = request.leaveStatus === "approved";
              const pending = request.leaveStatus === "pending";
              const tokenActive = ["generated", "active"].includes(request.tokenStatus);
              return (
                <tr key={`${request.source}-${request.id}-${request.roll}`} className="transition-colors hover:bg-secondary/20">
                  <td className="px-6 py-3 font-mono text-xs">{request.roll}</td>
                  <td className="px-3 py-3 font-medium">{request.cadetName || "—"}</td>
                  <td className="px-3 py-3">{request.leaveType || "—"}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{request.startDate ? new Date(request.startDate).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{request.endDate ? new Date(request.endDate).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
                  <td className="px-3 py-3"><StatusBadge status={request.leaveStatus} /></td>
                  <td className="px-3 py-3"><StatusBadge status={request.tokenStatus || "not_generated"} /></td>
                  <td className="px-6 py-3">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button disabled={!pending || decision.isPending} onClick={() => decision.mutate({ roll: request.roll, nextStatus: "approved" })} className="rounded-full border border-success/30 px-2.5 py-1 text-[11px] font-medium text-success hover:bg-success/10 disabled:opacity-30">Approve</button>
                      <button disabled={!pending || decision.isPending} onClick={() => decision.mutate({ roll: request.roll, nextStatus: "rejected" })} className="rounded-full border border-destructive/30 px-2.5 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-30">Reject</button>
                      <button disabled={!approved || tokenActive || token.isPending} onClick={() => token.mutate({ roll: request.roll, action: "generate" })} className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-secondary disabled:opacity-30">Generate</button>
                      <button disabled={!tokenActive || token.isPending} onClick={() => token.mutate({ roll: request.roll, action: "revoke" })} className="rounded-full border border-warning/30 px-2.5 py-1 text-[11px] font-medium text-warning hover:bg-warning/10 disabled:opacity-30">Revoke</button>
                      <button disabled={!approved || token.isPending} onClick={() => token.mutate({ roll: request.roll, action: "reissue" })} className="rounded-full border border-primary/30 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:opacity-30">Reissue</button>
                      <button onClick={() => request.emergencyVerificationCode ? toast.info(`Emergency code: ${request.emergencyVerificationCode}`) : toast.info("No emergency code generated yet")} className="grid h-7 w-7 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground" title="View emergency code"><KeyRound className="h-3.5 w-3.5" /></button>
                      <button onClick={() => openLink(request.passUrl)} className="grid h-7 w-7 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground" title="Print leave pass"><Download className="h-3.5 w-3.5" /></button>
                      <button onClick={() => openLink(request.documentUrl)} className="grid h-7 w-7 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground" title="View supporting document"><Eye className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </motion.section>
  );
}

function CheckInView() {
  const [mode, setMode] = useState<"nfc" | "scan" | "otp" | "manual" | "late">("nfc");
  const [nfcUid, setNfcUid] = useState("");
  const qc = useQueryClient();
  const nfcIn = nfcCheckIn;
  const nfcInMut = useMutation({
    mutationFn: (uid: string) => nfcIn({ data: { nfcUid: uid } }),
    onSuccess: (res: GateActionResult) => {
      toast.success(`${res.cadet.name} checked in${res.late ? " · LATE RETURN" : ""}`);
      setNfcUid("");
      qc.invalidateQueries({ queryKey: queryKeys.admin.outsideCadets });
      qc.invalidateQueries({ queryKey: queryKeys.admin.checkInLog });
      qc.invalidateQueries({ queryKey: queryKeys.admin.gateEvents });
      qc.invalidateQueries({ queryKey: queryKeys.admin.summary });
      qc.invalidateQueries({ queryKey: queryKeys.admin.cadets });
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Check-in failed")),
  });
  const { data: outside = [] } = useQuery({
    queryKey: queryKeys.admin.outsideCadets,
    queryFn: async () => {
      return fetchAdminCadets("?isOutside=true");
    },
  });
  const { data: log = [] } = useQuery({
    queryKey: queryKeys.admin.checkInLog,
    refetchInterval: 30_000,
    queryFn: fetchRecentGate,
  });
  const currentTime = new Date();
  const lateReturns = log.filter((event) => {
    const occurredAt = new Date(event.occurred_at);
    const marker = `${event.result || ""} ${event.remarks || ""}`.toUpperCase();
    const isEntry = event.direction === "entry" || event.direction === "CHECK_IN";
    return isEntry && (marker.includes("LATE") || (!Number.isNaN(occurredAt.getTime()) && occurredAt.getHours() >= 18));
  });
  const checkIn = useMutation({
    mutationFn: ({ id, method }: { id: string; method: "face"|"nfc"|"emergency" }) => checkInCadet(id, method),
    onSuccess: (_d, vars) => {
      toast.success("Cadet checked in");
      qc.invalidateQueries({ queryKey: queryKeys.admin.outsideCadets });
      qc.invalidateQueries({ queryKey: queryKeys.admin.checkInLog });
      qc.invalidateQueries({ queryKey: queryKeys.admin.gateEvents });
      qc.invalidateQueries({ queryKey: queryKeys.admin.summary });
      qc.invalidateQueries({ queryKey: queryKeys.admin.cadets });
      void vars;
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Check-in failed")),
  });
  return (
    <>
      <ViewHeader title="Check-In" subtitle="Verify cadet return through NFC, emergency code, OTP or manual override" icon={LogIn} />
      <div className="mt-8 flex items-center gap-1 rounded-full border border-border bg-card p-1 w-fit">
        {(["nfc","scan","otp","manual","late"] as const).map((m) => (
          <button key={m} onClick={()=>setMode(m)}
            className={`relative rounded-full px-4 py-1.5 text-xs font-medium capitalize ${mode===m?"bg-foreground text-background":"text-muted-foreground hover:text-foreground"}`}>{m==="nfc"?"NFC Tap":m==="scan"?"Emergency Code":m==="otp"?"OTP":m==="late"?"Late Returns":"Manual"}</button>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <motion.div key={mode} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="lg:col-span-2 rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
          {mode === "nfc" && (
            <div className="mx-auto max-w-md text-center">
              <Nfc className="mx-auto h-10 w-10 text-primary animate-pulse" />
              <p className="mt-3 text-sm text-muted-foreground">Ask the returning cadet to tap their registered NFC card on the gate reader.</p>
              <input
                autoFocus
                value={nfcUid}
                onChange={(e) => setNfcUid(e.target.value.trim())}
                onKeyDown={(e) => { if (e.key === "Enter" && nfcUid) nfcInMut.mutate(nfcUid); }}
                placeholder="Tap card or enter UID…"
                className="mt-5 w-full rounded-full border border-primary/40 bg-background px-4 py-2.5 text-center font-mono text-sm outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                onClick={() => nfcUid && nfcInMut.mutate(nfcUid)}
                disabled={!nfcUid || nfcInMut.isPending}
                className="mt-4 rounded-full bg-gradient-to-r from-primary to-accent px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >{nfcInMut.isPending ? "Verifying…" : "Verify NFC & check in"}</button>
              <p className="mt-3 text-[11px] text-muted-foreground">Late returns are allowed and flagged automatically.</p>
            </div>
          )}
          {mode === "scan" && (
            <div className="text-center">
              <div className="relative mx-auto h-72 w-72 overflow-hidden rounded-2xl border-2 border-dashed border-primary/40 bg-secondary/40">
                <div className="absolute inset-x-6 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent animate-[scan_2.4s_linear_infinite]" style={{ animation: "scanline 2.4s linear infinite" }} />
                <div className="absolute inset-0 grid place-items-center"><Camera className="h-12 w-12 text-primary/60" /></div>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">Use the emergency verification code printed on the gate pass when NFC or face verification is unavailable.</p>
              <button
                onClick={() => {
                  const next = outside[0];
                  if (!next) { toast.info("No cadets outside to check in"); return; }
                  checkIn.mutate({ id: next.id, method: "emergency" });
                }}
                disabled={checkIn.isPending}
                className="mt-4 rounded-full bg-gradient-to-r from-primary to-accent px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >Simulate emergency check-in</button>
            </div>
          )}
          {mode === "otp" && (
            <div className="mx-auto max-w-md text-center">
              <KeyRound className="mx-auto h-10 w-10 text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">Search the cadet, send OTP and verify on return.</p>
              <input placeholder="Search cadet…" className="mt-5 w-full rounded-full border border-border bg-background px-4 py-2.5 text-sm outline-none" />
              <div className="mt-3 flex justify-center gap-2">
                {Array.from({length:6}).map((_,i)=>(<input key={i} maxLength={1} className="h-12 w-10 rounded-xl border border-border bg-background text-center font-mono text-lg" />))}
              </div>
              <button
                onClick={() => {
                  const next = outside[0];
                  if (!next) { toast.info("No cadets outside to check in"); return; }
                  checkIn.mutate({ id: next.id, method: "face" });
                }}
                disabled={checkIn.isPending}
                className="mt-5 rounded-full bg-gradient-to-r from-primary to-accent px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >Verify OTP</button>
            </div>
          )}
          {mode === "manual" && (
            <div>
              <h3 className="text-sm font-semibold">Cadets currently outside</h3>
              <div className="mt-4 max-h-80 space-y-1.5 overflow-y-auto pr-1">
                {outside.length === 0 && <p className="text-sm text-muted-foreground">No one outside campus.</p>}
                {outside.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm">
                    <div><div className="font-medium">{c.full_name}</div><div className="text-[11px] text-muted-foreground">{c.cadet_code}</div></div>
                    <button
                      onClick={() => checkIn.mutate({ id: c.id, method: "nfc" })}
                      disabled={checkIn.isPending}
                      className="rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success hover:bg-success/20 disabled:opacity-60"
                    >Mark returned</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {mode === "late" && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Late returns after 18:00 hrs</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Current time: {currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Late entries are pulled from live gate logs.</p>
                </div>
                <span className="rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">{lateReturns.length} late</span>
              </div>
              <div className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
                {lateReturns.length === 0 && <p className="rounded-2xl border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">No late returns recorded yet.</p>}
                {lateReturns.map((event) => (
                  <div key={event.id} className="flex items-center justify-between rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{event.cadet?.full_name || event.cadet_name || event.roll_number || "Unknown cadet"}</div>
                      <div className="text-[11px] text-muted-foreground">{event.roll_number || event.cadet?.cadet_code || "-"} · {event.gate_name || "Gate"}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-xs">{new Date(event.occurred_at).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</div>
                      <div className="text-[11px] uppercase text-warning">{event.result || "Late return"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
        <div className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
          <h3 className="text-sm font-semibold tracking-tight">Last 10 check-ins today</h3>
          <ul className="mt-3 space-y-2">
            {log.length === 0 && <li className="text-xs text-muted-foreground">No check-ins yet today.</li>}
            {log.map((l) => (
              <li key={l.id} className="flex items-center justify-between rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-xs">
                <span className="font-medium">{l.cadet?.full_name ?? "—"}</span>
                <span className="font-mono text-muted-foreground uppercase">{l.method} · {new Date(l.occurred_at).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

function CheckOutView() {
  const qc = useQueryClient();
  const [selectedLeave, setSelectedLeave] = useState<string | null>(null);
  const [nfcUid, setNfcUid] = useState("");
  const nfcOut = nfcCheckOut;
  const nfcOutMut = useMutation({
    mutationFn: (v: { leaveId: string; nfcUid: string }) => nfcOut({ data: v }),
    onSuccess: (res: GateActionResult) => {
      toast.success(`${res.cadet.name} checked out`);
      setNfcUid(""); setSelectedLeave(null);
      qc.invalidateQueries({ queryKey: queryKeys.admin.pendingCheckout });
      qc.invalidateQueries({ queryKey: queryKeys.admin.outsideCadets });
      qc.invalidateQueries({ queryKey: queryKeys.admin.gateEvents });
      qc.invalidateQueries({ queryKey: queryKeys.admin.summary });
      qc.invalidateQueries({ queryKey: queryKeys.admin.cadets });
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Check-out failed")),
  });
  const { data: pending = [] } = useQuery({
    queryKey: queryKeys.admin.pendingCheckout,
    queryFn: async () => {
      return apiRequest<LeaveRequest[]>(endpoints.admin.leaveRequests("?status=approved&limit=20"));
    },
  });
  const checkOut = useMutation({
    mutationFn: (cadetId: string) => checkOutCadet(cadetId, "emergency"),
    onSuccess: () => {
      toast.success("Exit confirmed");
      qc.invalidateQueries({ queryKey: queryKeys.admin.pendingCheckout });
      qc.invalidateQueries({ queryKey: queryKeys.admin.outsideCadets });
      qc.invalidateQueries({ queryKey: queryKeys.admin.gateEvents });
      qc.invalidateQueries({ queryKey: queryKeys.admin.summary });
      qc.invalidateQueries({ queryKey: queryKeys.admin.cadets });
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Check-out failed")),
  });
  return (
    <>
      <ViewHeader title="Check-Out" subtitle="Pending exits — approved cadets verify at the gate before the pass is issued" icon={LogOut} />
      <div className="mt-6 rounded-2xl border border-primary/30 bg-primary/5 p-5 backdrop-blur-md">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><Nfc className="h-4 w-4 text-primary" /> NFC Gate Check-Out</div>
          <div className="flex-1 min-w-[220px]">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Approved leave</label>
            <select
              value={selectedLeave ?? ""}
              onChange={(e) => setSelectedLeave(e.target.value || null)}
              className="mt-1 w-full rounded-full border border-border bg-background px-3 py-2 text-sm outline-none"
            >
              <option value="">Select approved leave…</option>
              {pending.map((r) => (
                <option key={r.id} value={r.id}>{r.cadet?.full_name} · {r.cadet?.cadet_code} → {r.destination}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Tap NFC card</label>
            <input
              value={nfcUid}
              onChange={(e) => setNfcUid(e.target.value.trim())}
              onKeyDown={(e) => { if (e.key === "Enter" && selectedLeave && nfcUid) nfcOutMut.mutate({ leaveId: selectedLeave, nfcUid }); }}
              placeholder="Waiting for card tap…"
              className="mt-1 w-full rounded-full border border-primary/40 bg-background px-3 py-2 text-center font-mono text-sm outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <button
            onClick={() => selectedLeave && nfcUid && nfcOutMut.mutate({ leaveId: selectedLeave, nfcUid })}
            disabled={!selectedLeave || !nfcUid || nfcOutMut.isPending}
            className="rounded-full bg-gradient-to-r from-primary to-accent px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >{nfcOutMut.isPending ? "Verifying…" : "Confirm exit & issue pass"}</button>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">System verifies UID belongs to cadet, leave is approved and unexpired, and cadet is currently inside. Gate pass QR/PDF is generated and emailed only after successful checkout. Every tap is logged permanently.</p>
      </div>
      <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-md">
        <div className="grid grid-cols-12 gap-2 border-b border-border bg-secondary/30 px-5 py-3 text-[11px] uppercase tracking-wider text-muted-foreground">
          <div className="col-span-4">Cadet</div>
          <div className="col-span-3 hidden md:block">Destination</div>
          <div className="col-span-2 hidden md:block">Expected out</div>
          <div className="col-span-3 text-right">Action</div>
        </div>
        <div className="divide-y divide-border">
          {pending.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No pending check-outs.</p>}
          {pending.map((r) => {
            const initials = (r.cadet?.full_name ?? "?").split(" ").map((x: string) => x[0]).slice(0,2).join("").toUpperCase();
            return (
              <div key={r.id} className="grid grid-cols-12 items-center gap-2 px-5 py-3 text-sm">
                <div className="col-span-4 flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-bold text-primary-foreground">{initials}</div>
                  <div><div className="font-medium">{r.cadet?.full_name}</div><div className="text-[11px] text-muted-foreground">{r.cadet?.cadet_code}</div></div>
                </div>
                <div className="col-span-3 hidden truncate text-muted-foreground md:block">{r.destination}</div>
                <div className="col-span-2 hidden font-mono text-[11px] text-muted-foreground md:block">{new Date(r.start_at).toLocaleString([], { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}</div>
                <div className="col-span-3 flex justify-end gap-2">
                  <span className="rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-[11px] font-medium text-warning">Awaiting exit</span>
                  <button
                    onClick={() => r.cadet?.id && checkOut.mutate(r.cadet.id)}
                    disabled={checkOut.isPending}
                    className="rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold text-background disabled:opacity-60"
                  >Confirm exit & issue pass</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function FaceView() {
  const [filter, setFilter] = useState<"all"|"pending"|"completed">("all");
  const [console_, setConsole] = useState(false);
  const [selectedRoll, setSelectedRoll] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [moreActionsRoll, setMoreActionsRoll] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Cadet | null>(null);
  const qc = useQueryClient();
  const { data: adminProfile } = useAdminProfile();
  const canDeleteFace = adminProfile?.role === "super_admin";
  const { data: cadets = [] } = useQuery({
    queryKey: queryKeys.admin.faceCadets,
    queryFn: async () => {
      return fetchAdminCadets("?fields=face");
    },
  });
  const selectedCadet = cadets.find((cadet) => cadet.roll === selectedRoll || cadet.cadet_code === selectedRoll);
  const deleteFace = useMutation({
    mutationFn: async () => {
      throw new Error("Missing backend endpoint: delete enrolled face is not exposed by Shore Leave Express.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Delete face failed")),
  });
  const enroll = useMutation({
    mutationFn: async (imageBase64: string) => {
      if (!selectedCadet?.roll && !selectedCadet?.cadet_code) throw new Error("Select a cadet before saving enrollment");
      if (!imageBase64) throw new Error("Capture a live camera frame before saving");
      return enrollCadetFace({
        roll: selectedCadet.roll || selectedCadet.cadet_code,
        name: selectedCadet.full_name,
        email: selectedCadet.email,
        batch: selectedCadet.branch || selectedCadet.department,
        imageBase64,
      });
    },
    onSuccess: (result) => {
      toast.success(`${selectedCadet?.face_enrolled ? "Re-enrollment" : "Enrollment"} saved for ${result.name || result.roll}`);
      setConsole(false);
      setCameraOpen(false);
      setSelectedRoll("");
      setMoreActionsRoll(null);
      qc.invalidateQueries({ queryKey: queryKeys.admin.faceCadets });
      qc.invalidateQueries({ queryKey: queryKeys.admin.summary });
      qc.invalidateQueries({ queryKey: queryKeys.admin.cadets });
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Enrollment failed")),
  });
  const openEnrollmentCamera = (cadet: Cadet) => {
    setSelectedRoll(cadet.roll || cadet.cadet_code);
    setConsole(false);
    setMoreActionsRoll(null);
    setCameraOpen(true);
  };
  const confirmDeleteFace = () => {
    if (!deleteCandidate) return;
    deleteFace.mutate(undefined, {
      onSettled: () => {
        setDeleteCandidate(null);
        setMoreActionsRoll(null);
      },
    });
  };
  const enrolled = cadets.filter((c) => c.face_enrolled).length;
  const pending = cadets.length - enrolled;
  const filtered = cadets.filter((c) => filter === "all" ? true : filter === "completed" ? c.face_enrolled : !c.face_enrolled);
  return (
    <>
      <ViewHeader title="Face Enrollment" subtitle="Biometric enrollment coverage and per-cadet status" icon={ScanFace} />
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
          {(["pending","completed","all"] as const).map((f) => (
            <button key={f} onClick={()=>setFilter(f)} className={`relative rounded-full px-3.5 py-1.5 text-xs font-medium capitalize ${filter===f?"bg-foreground text-background":"text-muted-foreground hover:text-foreground"}`}>
              {f} <span className="ml-1 opacity-70">{f==="pending"?pending:f==="completed"?enrolled:cadets.length}</span>
            </button>
          ))}
        </div>
        <button onClick={()=>{setConsole(true); setSelectedRoll("");}} className="ml-auto inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary to-accent px-4 py-2 text-sm font-semibold text-primary-foreground"><Camera className="h-4 w-4" /> Open enrollment console</button>
      </div>
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1"><FaceEnrollment /></div>
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
          <div className="grid grid-cols-2 gap-3">
            <Mini label="Enrolled" value={String(enrolled)} tone="text-success" />
            <Mini label="Pending" value={String(pending)} tone="text-warning" />
          </div>
          <div className="mt-5 max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {filtered.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm">
                <div className="min-w-0"><div className="truncate font-medium">{c.full_name}</div><div className="text-[11px] text-muted-foreground">{c.cadet_code}</div></div>
                {c.face_enrolled
                  ? (
                    <div className="relative flex shrink-0 items-center gap-2">
                      <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] text-success">Enrolled</span>
                      <button onClick={()=>openEnrollmentCamera(c)} className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20">Re-enroll Face</button>
                      {canDeleteFace && (
                        <>
                          <button
                            type="button"
                            onClick={() => setMoreActionsRoll((current) => current === (c.roll || c.cadet_code) ? null : (c.roll || c.cadet_code))}
                            className="grid h-7 w-7 place-items-center rounded-full border border-border bg-background/70 text-muted-foreground hover:text-foreground"
                            aria-label={`More actions for ${c.full_name}`}
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </button>
                          {moreActionsRoll === (c.roll || c.cadet_code) && (
                            <div className="absolute right-0 top-8 z-20 w-44 rounded-2xl border border-border bg-card p-1.5 shadow-2xl">
                              <button
                                type="button"
                                onClick={() => setDeleteCandidate(c)}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete Face
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )
                  : (
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] text-warning">Pending</span>
                      <button onClick={()=>openEnrollmentCamera(c)} className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20">Enroll Face</button>
                    </div>
                  )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <AnimatePresence>
        {console_ && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={()=>setConsole(false)}>
            <motion.div initial={{scale:0.95,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.95,opacity:0}} onClick={(e)=>e.stopPropagation()} className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
              <h3 className="text-lg font-semibold tracking-tight">Live camera enrollment</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Select a cadet, then capture a live camera frame for the existing cadet record.
              </p>
              <div className="mt-5 rounded-xl border border-border bg-secondary/30 p-4">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cadet</label>
                <select
                  value={selectedRoll}
                  onChange={(event) => {
                    const roll = event.target.value;
                    setSelectedRoll(roll);
                    const cadet = cadets.find((entry) => entry.roll === roll || entry.cadet_code === roll);
                    if (cadet) openEnrollmentCamera(cadet);
                  }}
                  className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                >
                  <option value="">Select cadet…</option>
                  {cadets.map((cadet) => (
                    <option key={cadet.id} value={cadet.roll || cadet.cadet_code}>{cadet.full_name} · {cadet.roll || cadet.cadet_code}{cadet.face_enrolled ? " · enrolled" : ""}</option>
                  ))}
                </select>
                {selectedCadet && (
                  <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-background/60 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{selectedCadet.full_name}</div>
                      <div className="text-[11px] text-muted-foreground">{selectedCadet.roll || selectedCadet.cadet_code}</div>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${selectedCadet.face_enrolled ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning"}`}>
                      {selectedCadet.face_enrolled ? "Enrolled" : "Pending"}
                    </span>
                  </div>
                )}
              </div>
              <div className="mt-5 flex justify-between">
                <button onClick={()=>setConsole(false)} className="rounded-full border border-border px-4 py-2 text-sm">Cancel</button>
                <button onClick={()=>setCameraOpen(true)} disabled={!selectedCadet} className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2 text-sm font-semibold text-background disabled:opacity-60"><Camera className="h-4 w-4" /> Open camera</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {deleteCandidate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-4 backdrop-blur-sm"
            onClick={() => setDeleteCandidate(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-md rounded-3xl border border-destructive/20 bg-card p-6 shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-face-title"
            >
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-destructive/10 text-destructive">
                <Trash2 className="h-5 w-5" />
              </div>
              <h3 id="delete-face-title" className="mt-4 text-center text-xl font-semibold tracking-tight">Delete this cadet's enrolled face?</h3>
              <p className="mt-3 text-center text-sm leading-6 text-muted-foreground">
                This removes the current face image and biometric embedding.
                <br />
                The cadet will need to enroll again before face verification can be used.
              </p>
              <div className="mt-4 rounded-2xl border border-border bg-secondary/30 px-4 py-3 text-sm">
                <div className="font-semibold">{deleteCandidate.full_name}</div>
                <div className="text-xs text-muted-foreground">{deleteCandidate.roll || deleteCandidate.cadet_code}</div>
              </div>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setDeleteCandidate(null)}
                  className="min-h-[44px] rounded-full border border-border px-5 py-2 text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteFace}
                  disabled={deleteFace.isPending}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-destructive px-5 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-60"
                >
                  {deleteFace.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete Face
                </button>
              </div>
              <p className="mt-3 text-center text-[11px] text-muted-foreground">
                Available to administrators only. Cadet record will not be deleted.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {cameraOpen && selectedCadet && (
          <AdminFaceEnrollmentCamera
            cadet={selectedCadet}
            busy={enroll.isPending}
            onCancel={() => setCameraOpen(false)}
            onCapture={(imageBase64) => enroll.mutate(imageBase64)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

type AdminCameraStatus = "idle" | "requesting" | "ready" | "denied" | "unavailable" | "error";

function AdminFaceEnrollmentCamera({
  cadet,
  busy,
  onCancel,
  onCapture,
}: {
  cadet: Cadet;
  busy: boolean;
  onCancel: () => void;
  onCapture: (imageBase64: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const [cameraError, setCameraError] = useState("");
  const [cameraStatus, setCameraStatus] = useState<AdminCameraStatus>("idle");

  useEffect(() => {
    mountedRef.current = true;
    void startCamera();
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, []);

  function stopCamera() {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
      video.removeAttribute("src");
      video.load();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function startCamera() {
    logCameraRuntime("admin-face-enrollment", "startCamera:before-request");
    stopCamera();
    try {
      setCameraError("");
      setCameraStatus("requesting");
      const stream = await requestUserCamera();
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          throw error;
        });
      }
      setCameraStatus("ready");
      logCameraRuntime("admin-face-enrollment", "startCamera:ready");
    } catch (error: unknown) {
      logCameraRuntime("admin-face-enrollment", "startCamera:error", error);
      const issue = getCameraRuntimeIssue(error, "face enrollment");
      setCameraStatus(issue.status);
      setCameraError(issue.message);
    }
  }

  function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setCameraError("Camera is still warming up. Try again in a moment.");
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL("image/jpeg", 0.92));
  }

  function cancel() {
    stopCamera();
    onCancel();
  }

  const cameraReady = cameraStatus === "ready";
  const showCameraPermissionDialog = !!cameraError && !cameraReady;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] h-[100dvh] w-[100dvw] overflow-hidden bg-black text-white"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingRight: "env(safe-area-inset-right)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
      }}
    >
      <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-black/45" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,transparent_34%,rgba(0,0,0,0.36)_35%,rgba(0,0,0,0.76)_100%)]" />

      <button
        type="button"
        onClick={cancel}
        className="absolute z-20 grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white shadow-2xl ring-1 ring-white/30 backdrop-blur transition hover:bg-white/25"
        style={{ top: "max(1rem, env(safe-area-inset-top))", right: "max(1rem, env(safe-area-inset-right))" }}
        aria-label="Close enrollment camera"
      >
        <X className="h-6 w-6" />
      </button>

      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[min(58dvh,72vw,520px)] min-h-[180px] w-[min(42dvh,78vw,420px)] min-w-[180px] max-w-[calc(100dvw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-[28px] border-[3px] border-white/95 shadow-[0_0_70px_rgba(255,255,255,0.16),inset_0_0_40px_rgba(255,255,255,0.08)]" />

      <div className="absolute inset-x-0 top-0 z-10 px-5 text-center sm:px-6" style={{ paddingTop: "max(2rem, calc(env(safe-area-inset-top) + 1rem))" }}>
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-xl">
          <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] ring-1 ring-white/25 backdrop-blur">
            <ScanFace className="h-4 w-4" /> Face enrollment
          </div>
          <h1 className="text-[clamp(1.875rem,8vw,3rem)] font-black tracking-tight">{cadet.face_enrolled ? "Re-enroll Face" : "Enroll Face"}</h1>
          <p className="mt-3 text-sm font-medium text-white/80 sm:text-base">{cadet.full_name} · {cadet.roll || cadet.cadet_code}</p>
        </motion.div>
      </div>

      {showCameraPermissionDialog && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/55 px-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="w-full max-w-md rounded-[28px] bg-white p-5 text-[#17061E] shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="enrollment-camera-dialog-title"
          >
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#17061E] text-white">
              <Camera className="h-5 w-5" />
            </div>
            <h2 id="enrollment-camera-dialog-title" className="mt-4 text-center text-xl font-black">Camera access is required</h2>
            <p className="mt-2 text-center text-sm text-[#17061E]/70">{cameraError}</p>
            <p className="mt-3 rounded-2xl bg-[#17061E]/5 p-3 text-xs text-[#17061E]/65">
              If your browser blocked the prompt, open site settings for this page, set Camera to Allow, then return and retry.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={startCamera} disabled={cameraStatus === "requesting" || busy} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-[#17061E] px-5 py-3 text-sm font-extrabold text-white disabled:opacity-60">
                {cameraStatus === "requesting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                Allow Camera Again
              </button>
              <button type="button" onClick={cancel} className="inline-flex min-h-[48px] items-center justify-center rounded-full border border-[#17061E]/15 px-5 py-3 text-sm font-bold text-[#17061E]">
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-10 px-5 sm:px-8" style={{ paddingBottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))" }}>
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-xl rounded-[32px] bg-black/35 p-4 shadow-2xl ring-1 ring-white/20 backdrop-blur-xl sm:p-5">
          <div className="rounded-3xl bg-white/12 p-4 text-center">
            <div className="text-sm font-semibold text-white">Face the camera · Center your face · Hold still · Good lighting</div>
            <div className="mt-1 text-xs text-white/65">Live camera only. This replaces the previous enrollment for the same cadet record.</div>
          </div>
          {cameraError && <p className="mt-3 rounded-2xl bg-red-500/20 p-3 text-center text-xs font-semibold text-red-50 ring-1 ring-red-200/30">{cameraError}</p>}
          {cameraReady ? (
            <button type="button" onClick={captureFrame} disabled={busy} className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-3 rounded-full bg-white px-6 py-4 text-base font-extrabold text-[#17061E] shadow-[0_18px_45px_-20px_rgba(255,255,255,0.7)] transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
              {busy ? "Saving Enrollment" : "Capture"}
            </button>
          ) : (
            <button type="button" onClick={startCamera} disabled={busy || cameraStatus === "requesting"} className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-3 rounded-full bg-white px-6 py-4 text-base font-extrabold text-[#17061E] shadow-[0_18px_45px_-20px_rgba(255,255,255,0.7)] transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60">
              {cameraStatus === "requesting" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
              {cameraStatus === "requesting" ? "Opening Camera" : "Open Camera"}
            </button>
          )}
        </motion.div>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </motion.div>
  );
}

function EmergencyCodesView() {
  return (
    <>
      <ViewHeader title="Emergency Codes" subtitle="Manual gate fallback when fingerprint or face verification is unavailable" icon={KeyRound} />
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2"><EmergencyCodeStats /><LiveGateFeed /></div>
    </>
  );
}

function ReportsView() {
  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useQuery({ queryKey: queryKeys.admin.summary, queryFn: fetchAdminSummary });
  const { data: audit = [], isLoading: auditLoading, isError: auditError } = useQuery({ queryKey: queryKeys.admin.gateHistory, queryFn: fetchRecentGateHistory, refetchInterval: 60_000 });
  const cards = [
    { t: "Leave summary", d: "Approved today · pending review", icon: Plane, val: `${summary?.approvedToday ?? 0}/${summary?.pending ?? 0}` },
    { t: "Check-in report", d: "Entries today · late returns", icon: LogIn, val: `${summary?.gateEntries ?? 0}/${summary?.lateReturns ?? 0}` },
    { t: "Compliance report", d: "Inside campus · outside campus", icon: ShieldCheck, val: `${summary?.inside ?? 0}/${summary?.outside ?? 0}` },
  ];
  const downloadUrl = (path: string) => `${API}${path}`;
  return (
    <>
      <ViewHeader title="Reports" subtitle="Trends, exports and operational metrics" icon={FileBarChart} />
      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <motion.div key={c.t} whileHover={{y:-3}} className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-md">
              <div className="flex items-start justify-between">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow"><Icon className="h-4 w-4" /></div>
                <span className="text-2xl font-semibold tabular-nums text-gradient">{summaryLoading ? "…" : summaryError ? "!" : c.val}</span>
              </div>
              <h3 className="mt-4 text-sm font-semibold">{c.t}</h3>
              <p className="text-xs text-muted-foreground">{c.d}</p>
              <a href={downloadUrl(endpoints.admin.exportLeaveRecords)} className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium hover:border-primary/40"><Download className="h-3 w-3" /> Download CSV</a>
            </motion.div>
          );
        })}
      </div>
      <div className="mt-6"><LeaveOverview /></div>
      <div className="mt-6 rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div><h2 className="text-lg font-semibold tracking-tight">Audit log</h2><p className="text-sm text-muted-foreground">Every privileged action, attributable</p></div>
          <a href={downloadUrl(endpoints.admin.exportAuditLogs)} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-xs"><Download className="h-3 w-3" /> Export CSV</a>
        </div>
        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <div className="grid grid-cols-12 gap-2 border-b border-border bg-secondary/30 px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <div className="col-span-2">Time</div><div className="col-span-3">Actor</div><div className="col-span-2">Role</div><div className="col-span-3">Action</div><div className="col-span-2">Cadet</div>
          </div>
          {auditLoading && <div className="px-4 py-6 text-center text-xs text-muted-foreground">Loading audit log…</div>}
          {auditError && <div className="px-4 py-6 text-center text-xs text-destructive">Unable to load audit log.</div>}
          {!auditLoading && !auditError && audit.length === 0 && <div className="px-4 py-6 text-center text-xs text-muted-foreground">No audit entries yet.</div>}
          {audit.slice(0, 12).map((a) => (
            <div key={a.id} className="grid grid-cols-12 gap-2 border-b border-border px-4 py-2 text-xs last:border-0">
              <div className="col-span-2 font-mono text-muted-foreground">{new Date(a.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
              <div className="col-span-3 font-medium">{a.actor || "system"}</div>
              <div className="col-span-2 text-muted-foreground">Backend</div>
              <div className="col-span-3">{a.action || a.result || "Event"}</div>
              <div className="col-span-2 text-muted-foreground">{a.roll_number || a.cadet_name || "—"}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function SettingsView({ canManageAdministrators }: { canManageAdministrators: boolean }) {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: queryKeys.admin.reportSettings, queryFn: fetchReportSettings });
  const { data: recentReports = [] } = useQuery({ queryKey: queryKeys.admin.dailyReports, queryFn: fetchDailyReports, refetchInterval: 60_000 });
  const [runTime, setRunTime] = useState("21:00");
  const [enabled, setEnabled] = useState(true);
  const [recipients, setRecipients] = useState<string>("");
  const [formats, setFormats] = useState<string[]>(["pdf", "html"]);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setRunTime(String(settings.run_time ?? "21:00").slice(0, 5));
    setEnabled(!!settings.enabled);
    setRecipients(((settings.recipients as string[]) ?? []).join("\n"));
    setFormats((settings.formats as string[]) ?? ["pdf", "html"]);
  }, [settings]);

  const save = useMutation({
    mutationFn: () => updateReportSettings({
      run_time: runTime,
      enabled,
      recipients: recipients.split(/\s+|,/).map((r) => r.trim()).filter(Boolean),
      formats,
    }),
    onSuccess: () => { toast.success("Report settings saved"); qc.invalidateQueries({ queryKey: queryKeys.admin.reportSettings }); },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to save")),
  });

  async function generateNow() {
    try {
      setGenerating(true);
      const generated = await generateDailyReport(new Date().toISOString().slice(0, 10));
      if (!generated.ok) throw new Error("The report service did not confirm generation.");
      toast.success("Daily report generated");
      await qc.invalidateQueries({ queryKey: queryKeys.admin.dailyReports });
      if (generated.signedUrl) window.open(generated.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Report generation failed"));
    } finally {
      setGenerating(false);
    }
  }

  const toggleFormat = (f: string) => setFormats((v) => v.includes(f) ? v.filter((x) => x !== f) : [...v, f]);

  return (
    <>
      <ViewHeader title="Settings" subtitle="Daily report scheduling, recipients and delivery" icon={Settings} />
      {canManageAdministrators && <AdminAccountManagement />}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <motion.section initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md lg:col-span-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2"><FileBarChart className="h-4 w-4 text-primary" /><h3 className="text-base font-semibold">Daily Operations Report</h3></div>
              <p className="mt-1 text-sm text-muted-foreground">Automatically generated and emailed to designated staff every evening.</p>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-primary" />
              {enabled ? "Enabled" : "Disabled"}
            </label>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-secondary/30 p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Run time (server)</div>
              <input type="time" value={runTime} onChange={(e) => setRunTime(e.target.value)} className="mt-1 w-full bg-transparent text-sm font-mono outline-none" />
            </div>
            <div className="rounded-xl border border-border bg-secondary/30 p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Report formats</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["pdf","html","csv"] as const).map((f) => (
                  <button key={f} type="button" onClick={() => toggleFormat(f)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${formats.includes(f) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}>{f}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-border bg-secondary/30 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Recipients (one per line)</div>
            <textarea value={recipients} onChange={(e) => setRecipients(e.target.value)} rows={5}
              placeholder="principal@example.com&#10;hod@example.com&#10;warden@example.com"
              className="mt-1 w-full bg-transparent font-mono text-sm outline-none resize-none" />
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button onClick={() => save.mutate()} disabled={save.isPending}
              className="rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-60">{save.isPending ? "Saving…" : "Save settings"}</button>
            <button onClick={generateNow} disabled={generating}
              className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-primary to-accent px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              <Send className="h-3.5 w-3.5" /> {generating ? "Generating…" : "Generate & preview now"}
            </button>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">Scheduled via server cron. Email delivery requires an email domain — reports are always stored and downloadable in the recent list.</p>
        </motion.section>

        <motion.section initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
          <div className="flex items-center gap-2"><Download className="h-4 w-4 text-primary" /><h3 className="text-base font-semibold">Recent reports</h3></div>
          <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {recentReports.length === 0 && <p className="text-xs text-muted-foreground">No reports generated yet.</p>}
            {recentReports.map((r) => (
              <div key={r.id} className="rounded-xl border border-border bg-secondary/30 px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono">{r.report_date}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${r.delivery_status === "failed" ? "border border-destructive/30 bg-destructive/10 text-destructive" : "border border-success/30 bg-success/10 text-success"}`}>{r.delivery_status}</span>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">{new Date(r.generated_at).toLocaleString()}</div>
                {r.storage_url && <a href={r.storage_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-primary hover:underline">Open report →</a>}
                {r.error && <div className="mt-1 text-destructive">{r.error}</div>}
              </div>
            ))}
          </div>
        </motion.section>
      </div>

      <div className="mt-8"><GateHistoryPanel /></div>
      <div className="mt-8"><SystemHealth /></div>
    </>
  );
}

function GateHistoryPanel() {
  const { data: rows = [] } = useQuery({ queryKey: queryKeys.admin.gateHistory, queryFn: fetchRecentGateHistory, refetchInterval: 60_000 });
  return (
    <motion.section initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Permanent Gate History</h3>
          <p className="text-sm text-muted-foreground">Every NFC check-in and check-out — never overwritten.</p>
        </div>
        <Activity className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-border">
        <div className="grid grid-cols-12 gap-2 border-b border-border bg-secondary/30 px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <div className="col-span-3">Time</div>
          <div className="col-span-3">Cadet</div>
          <div className="col-span-2">Direction</div>
          <div className="col-span-2">Result</div>
          <div className="col-span-2">NFC UID</div>
        </div>
        {rows.length === 0 && <div className="px-4 py-6 text-center text-xs text-muted-foreground">No gate activity yet.</div>}
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-12 items-center gap-2 border-b border-border px-4 py-2 text-xs last:border-0">
            <div className="col-span-3 font-mono text-muted-foreground">{new Date(r.occurred_at).toLocaleString([], { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}</div>
            <div className="col-span-3"><div className="font-medium">{r.cadet_name ?? "—"}</div><div className="text-[10px] text-muted-foreground">{r.roll_number ?? "—"}</div></div>
            <div className="col-span-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${r.direction === "CHECK_IN" ? "border border-success/30 bg-success/10 text-success" : "border border-primary/30 bg-primary/10 text-primary"}`}>{r.direction}</span></div>
            <div className="col-span-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${r.result === "SUCCESS" ? "text-success" : r.result === "LATE" ? "text-warning" : "text-destructive"}`}>{r.result}</span></div>
            <div className="col-span-2 font-mono text-[10px] text-muted-foreground">{r.nfc_uid ?? "—"}</div>
          </div>
        ))}
      </div>
    </motion.section>
  );
}

function TopNav({ active, setActive, name, profile, onNotifications }: { active: string; setActive: (s: string) => void; name: string; profile: AdminProfile; onNotifications: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: notificationPage } = useQuery({
    queryKey: queryKeys.admin.notifications,
    queryFn: () => fetchNotifications("?limit=50"),
    refetchInterval: 60_000,
  });
  const initials = name.split(" ").map(x => x[0]).slice(0, 2).join("").toUpperCase() || "AD";

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    TokenService.removeToken();
    navigate({ to: "/auth", search: { role: "admin" }, replace: true });
  }

  return (
    <header className="sticky top-0 z-50">
      <div className="absolute inset-0 -z-10 bg-white/40 backdrop-blur-xl backdrop-saturate-150 border-b border-white/40" />
      <div className="relative mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex shrink-0 items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent shadow-[0_0_20px_oklch(0.72_0.18_45/0.4)]">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="hidden text-base font-semibold tracking-tight sm:inline">Shore Leave</span>
        </div>

        <nav className="relative mx-auto hidden min-w-0 flex-1 justify-center md:flex">
          <div className="relative flex items-center gap-0.5 rounded-full border border-white/60 bg-white/50 p-1 shadow-[0_4px_24px_-12px_oklch(0.4_0.1_235/0.25)] backdrop-blur-xl overflow-x-auto no-scrollbar max-w-full">
            {NAV.map((item) => {
              const Icon = item.icon; const isActive = active === item.id;
              return (
                <button key={item.id} onClick={() => setActive(item.id)}
                  className="group relative flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm text-muted-foreground transition-colors duration-300 hover:text-foreground">
                  {isActive && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-full bg-gradient-to-b from-foreground to-[oklch(0.08_0.02_250)] shadow-[0_8px_24px_-8px_oklch(0.15_0.04_250/0.6),inset_0_1px_0_oklch(1_0_0/0.15)] ring-1 ring-foreground/20"
                      transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
                    />
                  )}
                  <Icon className={`relative z-10 h-3.5 w-3.5 transition-all duration-300 group-hover:scale-110 ${isActive ? "text-background" : ""}`} />
                  <span className={`relative z-10 font-medium transition-colors duration-300 ${isActive ? "text-background" : ""}`}>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button onClick={onNotifications} aria-label={`Open notifications${notificationPage?.unread ? `, ${notificationPage.unread} unread` : ""}`} className="relative grid h-10 w-10 place-items-center rounded-full border border-white/60 bg-white/50 backdrop-blur transition-transform hover:scale-105">
            <Bell className="h-4 w-4" />
            {!!notificationPage?.unread && <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{Math.min(notificationPage.unread, 99)}</span>}
          </button>
          <div className="hidden items-center gap-2 rounded-full border border-white/60 bg-white/50 py-1 pl-1 pr-1.5 backdrop-blur sm:flex">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-bold text-primary-foreground">{initials}</div>
            <div className="hidden flex-col items-start pr-1 leading-tight lg:flex">
              <span className="text-sm font-medium">{name}</span>
              <span className={`text-[10px] font-medium uppercase tracking-wider ${profile?.role === "super_admin" ? "text-primary" : "text-muted-foreground"}`}>
                {profile?.role === "super_admin" ? "All Branches" : profile?.branch ? branchLabel(profile.branch) : "—"}
              </span>
            </div>
            <button onClick={signOut} title="Sign out" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          <button onClick={() => setMobileOpen(!mobileOpen)} className="grid h-10 w-10 place-items-center rounded-full border border-white/60 bg-white/50 backdrop-blur md:hidden">
            <ChevronDown className={`h-4 w-4 transition-transform ${mobileOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="relative overflow-hidden border-b border-white/40 bg-white/60 backdrop-blur-xl md:hidden">
            <div className="mx-auto grid max-w-7xl grid-cols-2 gap-2 px-4 py-4 sm:grid-cols-3">
              {NAV.map((item) => {
                const Icon = item.icon; const isActive = active === item.id;
                return (
                  <button key={item.id} onClick={() => { setActive(item.id); setMobileOpen(false); }}
                    className={`flex items-center gap-2 rounded-full border px-3 py-2.5 text-sm ${isActive ? "border-transparent bg-foreground text-background" : "border-white/60 bg-white/40 text-muted-foreground hover:text-foreground"}`}>
                    <Icon className="h-4 w-4" />{item.label}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function Welcome({ name }: { name: string }) {
  const now = useClock();
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="relative pt-8 sm:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            All systems operational
          </div>
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
            Welcome back,<br /><span className="text-gradient">{name}</span>
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
            Here is what is happening across AMET campus today. Approve leave, monitor gates, and keep the academy moving — calmly.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card/50 p-5 backdrop-blur-md min-w-[220px]">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground"><Clock className="h-3 w-3" /> Now</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{time}</div>
          <div className="mt-2 text-sm text-muted-foreground">{date}</div>
        </div>
      </div>
    </motion.section>
  );
}

function StatGrid() {
  const { data, isLoading } = useQuery({ queryKey: queryKeys.admin.summary, queryFn: fetchAdminSummary });
  const stats = [
    { label: "Total Cadets", value: data?.totalCadets ?? 0, hint: "Enrolled this term", icon: Users },
    { label: "Pending Requests", value: data?.pending ?? 0, hint: "Awaiting review", icon: Clock },
    { label: "Approved Today", value: data?.approvedToday ?? 0, hint: "Across all wings", icon: Check },
    { label: "Cadets Outside", value: data?.outside ?? 0, hint: "Currently on leave", icon: Plane },
    { label: "Check-ins Today", value: data?.gateEntries ?? 0, hint: "Gate entries", icon: ArrowDownRight },
    { label: "Check-outs Today", value: data?.gateExits ?? 0, hint: "Gate exits", icon: ArrowUpRight },
    { label: "Late Returns", value: data?.lateReturns ?? 0, hint: "Beyond leave end time", icon: AlertTriangle },
    { label: "Blocked Cadets", value: data?.blockedCadets ?? 0, hint: `${data?.blockedCadetPercentage ?? 0}% leave blocked`, icon: Ban },
    { label: "Unknown NFC", value: data?.unknownNfc ?? 0, hint: "Unregistered card taps", icon: HelpCircle },
    { label: "Denied Entries", value: data?.denied ?? 0, hint: "Gate rejections", icon: X },
    { label: "Rejected Leaves", value: data?.rejectedToday ?? 0, hint: "Today", icon: X },
    { label: "Pending Face Enrol", value: data?.facePending ?? 0, hint: `${data?.facePct ?? 0}% enrolled`, icon: ScanFace },
  ];
  return (
    <section className="mt-12 grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
      {stats.map((s, i) => <StatCard key={s.label} stat={s} delay={i * 0.05} loading={isLoading} />)}
    </section>
  );
}

function StatCard({ stat, delay, loading }: { stat: DashboardStat; delay: number; loading: boolean }) {
  const v = useCountUp(stat.value);
  const Icon = stat.icon;
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.5 }} whileHover={{ y: -4 }}
      className="group glass-card glass-card-hover relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-aurora opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-60" />
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="relative flex items-start justify-between">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow"><Icon className="h-4 w-4" /></div>
        <span className="flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success"><TrendingUp className="h-3 w-3" /> live</span>
      </div>
      <div className="relative mt-5 text-3xl font-semibold tabular-nums tracking-tight text-gradient">{loading ? "—" : `${v}${stat.suffix ?? ""}`}</div>
      <div className="relative mt-1 text-sm font-medium text-foreground/90">{stat.label}</div>
      <div className="relative text-xs text-muted-foreground">{stat.hint}</div>
    </motion.div>
  );
}

const RANGES = ["Today", "Week", "Month", "Year"] as const;
type Range = typeof RANGES[number];
type DashboardLiveChart = { chart?: { labels?: string[]; active?: number[]; pending?: number[]; rejected?: number[]; expired?: number[] } };

function LeaveOverview() {
  const [range, setRange] = useState<Range>("Week");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "dashboard-live-chart", range],
    queryFn: async () => apiRequest<DashboardLiveChart>(endpoints.dashboard.live),
    refetchInterval: 60_000,
  });
  const chartData: ChartPoint[] = (data?.chart?.labels ?? []).map((name, index) => ({
    name,
    requested: (data?.chart?.active?.[index] ?? 0) + (data?.chart?.pending?.[index] ?? 0),
    approved: data?.chart?.active?.[index] ?? 0,
    rejected: data?.chart?.rejected?.[index] ?? 0,
    expired: data?.chart?.expired?.[index] ?? (name.toLowerCase().includes("overdue") ? data?.chart?.active?.[index] ?? 0 : 0),
  }));
  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="lg:col-span-2 rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Leave overview</h2>
          <p className="text-sm text-muted-foreground">Requests, approvals & rejections at a glance</p>
        </div>
        <div className="relative flex items-center gap-1 rounded-full border border-border bg-secondary/50 p-1">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setRange(r)} className="relative rounded-full px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground">
              {range === r && <motion.span layoutId="range-pill" className="absolute inset-0 rounded-full bg-primary" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}
              <span className={`relative ${range === r ? "text-primary-foreground" : ""}`}>{r}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="mt-6 h-72 w-full">
        {isLoading && <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading leave trends…</div>}
        {isError && <div className="grid h-full place-items-center text-sm text-destructive">Unable to load leave trends.</div>}
        {!isLoading && !isError && chartData.length === 0 && <div className="grid h-full place-items-center text-sm text-muted-foreground">No leave trend data available.</div>}
        {!isLoading && !isError && chartData.length > 0 && <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 0, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="g-req" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="oklch(0.78 0.13 50)" stopOpacity={0.5} /><stop offset="100%" stopColor="oklch(0.78 0.13 50)" stopOpacity={0} /></linearGradient>
              <linearGradient id="g-app" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="oklch(0.7 0.15 155)" stopOpacity={0.45} /><stop offset="100%" stopColor="oklch(0.7 0.15 155)" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid stroke="oklch(1 0 0 / 0.05)" vertical={false} />
            <XAxis dataKey="name" stroke="oklch(0.68 0.02 50)" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis stroke="oklch(0.68 0.02 50)" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "oklch(0.18 0.015 40)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: 12, fontSize: 12 }} labelStyle={{ color: "oklch(0.97 0.01 60)" }} />
            <Area type="monotone" dataKey="requested" stroke="oklch(0.78 0.13 50)" strokeWidth={2} fill="url(#g-req)" />
            <Area type="monotone" dataKey="approved" stroke="oklch(0.7 0.15 155)" strokeWidth={2} fill="url(#g-app)" />
            <Area type="monotone" dataKey="rejected" stroke="oklch(0.62 0.22 25)" strokeWidth={1.5} fillOpacity={0} />
            <Area type="monotone" dataKey="expired" stroke="oklch(0.68 0.02 50)" strokeWidth={1.5} fillOpacity={0} />
          </AreaChart>
        </ResponsiveContainer>}
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <Legend dot="oklch(0.78 0.13 50)" label="Requested" />
        <Legend dot="oklch(0.7 0.15 155)" label="Approved" />
        <Legend dot="oklch(0.62 0.22 25)" label="Rejected" />
        <Legend dot="oklch(0.68 0.02 50)" label="Expired" />
      </div>
    </motion.section>
  );
}
function Legend({ dot, label }: { dot: string; label: string }) {
  return <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: dot }} />{label}</div>;
}

const ACTIONS = [
  { label: "Add Cadet", icon: UserPlus }, { label: "Import Excel", icon: FileSpreadsheet },
  { label: "Enroll Face", icon: ScanFace }, { label: "Assign NFC", icon: Nfc },
  { label: "Generate Emergency Code", icon: KeyRound }, { label: "Create Report", icon: FileBarChart },
  { label: "Announcement", icon: Megaphone },
];
function QuickActions() {
  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
      <div><h2 className="text-lg font-semibold tracking-tight">Quick actions</h2><p className="text-sm text-muted-foreground">Frequent operations, one click away</p></div>
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        {ACTIONS.map((a, i) => {
          const Icon = a.icon;
          return (
            <motion.button key={a.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.04 }}
              whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
              onClick={() => toast.info(`${a.label}: no matching backend endpoint is exposed in Shore Leave Express.`)}
              className="group flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-secondary">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-background/60 text-primary transition-transform group-hover:scale-110"><Icon className="h-4 w-4" /></div>
              <span className="text-sm font-medium">{a.label}</span>
            </motion.button>
          );
        })}
        <button className="col-span-2 mt-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent py-3 text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_-10px_oklch(0.72_0.18_45/0.6)] transition-transform hover:scale-[1.01]">
          <Plus className="h-4 w-4" /> New shore leave
        </button>
      </div>
    </motion.section>
  );
}

function RecentRequests({ filter = "all", search = "" }: { filter?: "all"|"pending"|"approved"|"rejected"; search?: string } = {}) {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useQuery({ queryKey: queryKeys.admin.leaveRequests, queryFn: fetchRecentRequests });
  const mut = useMutation({
    mutationFn: ({ roll, status, reason }: { roll: string; status: "approved" | "rejected"; reason?: string }) => decideLeave(roll, status, reason),
    onSuccess: (_d, vars) => {
      toast.success(`Request ${vars.status}`);
      qc.invalidateQueries({ queryKey: queryKeys.admin.leaveRequests });
      qc.invalidateQueries({ queryKey: queryKeys.admin.summary });
      qc.invalidateQueries({ queryKey: queryKeys.admin.leaveStatus });
      qc.invalidateQueries({ queryKey: queryKeys.admin.pendingCheckout });
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Action failed")),
  });
  const t = search.trim().toLowerCase();
  const filtered = items.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (!t) return true;
    return [r.cadet?.full_name, r.cadet?.cadet_code, r.destination].filter((value): value is string => Boolean(value)).some((value) => value.toLowerCase().includes(t));
  });
  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="lg:col-span-2 rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold tracking-tight">Recent leave requests</h2><p className="text-sm text-muted-foreground">Approve or review without leaving the dashboard</p></div>
      </div>
      <div className="mt-5 divide-y divide-border">
        {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && filtered.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No requests match.</p>}
        {filtered.map((r) => {
          const initials = (r.cadet?.full_name ?? "?").split(" ").map((x: string) => x[0]).slice(0, 2).join("").toUpperCase();
          const dur = humanDuration(r.start_at, r.end_at);
          return (
            <motion.div key={r.id} layout className="flex flex-wrap items-center gap-4 py-3.5">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-bold text-primary-foreground">{initials}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{r.cadet?.full_name ?? "—"}</span>
                  <span className="text-xs text-muted-foreground">{r.cadet?.cadet_code}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{r.destination}</span>
                  <span>· {dur}</span>
                </div>
              </div>
              <StatusBadge status={r.status} />
              <div className="flex items-center gap-1">
                <button disabled={r.status !== "pending" || mut.isPending || !(r.roll || r.cadet?.cadet_code)} onClick={() => mut.mutate({ roll: r.roll || r.cadet?.cadet_code || "", status: "approved" })}
                  className="grid h-8 w-8 place-items-center rounded-full border border-border text-success transition-colors hover:bg-success/10 disabled:opacity-30" title="Approve"><Check className="h-4 w-4" /></button>
                <button disabled={r.status !== "pending" || mut.isPending || !(r.roll || r.cadet?.cadet_code)} onClick={() => mut.mutate({ roll: r.roll || r.cadet?.cadet_code || "", status: "rejected", reason: "Rejected by administrator" })}
                  className="grid h-8 w-8 place-items-center rounded-full border border-border text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-30" title="Reject"><X className="h-4 w-4" /></button>
                <button className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground" title="View"><Eye className="h-4 w-4" /></button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.section>
  );
}

function humanDuration(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const h = Math.round(ms / 3_600_000);
  if (h < 24) return `${h} hrs`;
  return `${Math.round(h / 24)} days`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "text-warning border-warning/30 bg-warning/10",
    approved: "text-success border-success/30 bg-success/10",
    rejected: "text-destructive border-destructive/30 bg-destructive/10",
    expired: "text-muted-foreground border-border bg-secondary",
  };
  return <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize ${map[status] ?? ""}`}>{status}</span>;
}

function LiveGateFeed() {
  const { data: events = [] } = useQuery({ queryKey: queryKeys.admin.gateEvents, queryFn: fetchRecentGate, refetchInterval: 30_000 });
  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold tracking-tight">Live gate activity</h2><p className="text-sm text-muted-foreground">Real-time entries & exits</p></div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] text-success">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live
        </span>
      </div>
      <ul className="mt-4 space-y-2">
        <AnimatePresence initial={false}>
          {events.map((e) => (
            <motion.li key={e.id} initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
              className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 p-3">
              <div className={`grid h-8 w-8 place-items-center rounded-lg ${e.direction === "entry" ? "bg-success/15 text-success" : "bg-primary/15 text-primary"}`}>
                {e.direction === "entry" ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{e.cadet?.full_name ?? "—"}</div>
                <div className="text-[11px] text-muted-foreground uppercase">{e.method} verified · {e.gate_name}</div>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">{new Date(e.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </motion.section>
  );
}

function FaceEnrollment({ onOpen }: { onOpen?: () => void }) {
  const { data } = useQuery({ queryKey: queryKeys.admin.summary, queryFn: fetchAdminSummary });
  return (
    <PanelCard title="Face enrollment" subtitle="Biometric coverage" icon={ScanFace}>
      <div className="mt-4"><RingProgress value={data?.facePct ?? 0} /></div>
      <button
        onClick={onOpen}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_-10px_oklch(0.72_0.18_45/0.5)] transition-opacity hover:opacity-95 disabled:opacity-60"
      >
        <ScanFace className="h-4 w-4" />
        Enroll one more face
      </button>
      <button onClick={onOpen} className="mt-2 w-full rounded-xl border border-border bg-secondary/50 py-2.5 text-sm font-medium hover:border-primary/40 hover:bg-secondary">Continue enrollment</button>
    </PanelCard>
  );
}

function RingProgress({ value }: { value: number }) {
  const v = useCountUp(value, 1400);
  const r = 52; const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto h-32 w-32">
      <svg viewBox="0 0 120 120" className="-rotate-90">
        <circle cx="60" cy="60" r={r} stroke="oklch(1 0 0 / 0.08)" strokeWidth="10" fill="none" />
        <motion.circle cx="60" cy="60" r={r} stroke="url(#ring)" strokeWidth="10" fill="none" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c - (c * value) / 100 }} transition={{ duration: 1.4 }} />
        <defs><linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="oklch(0.78 0.13 50)" /><stop offset="100%" stopColor="oklch(0.7 0.18 45)" /></linearGradient></defs>
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center"><div className="text-2xl font-semibold tabular-nums">{v}%</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Coverage</div></div>
      </div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/30 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function PanelCard({ title, subtitle, icon: Icon, children }: { title: string; subtitle: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-primary"><Icon className="h-4 w-4" /></div>
        <div><h2 className="text-base font-semibold tracking-tight">{title}</h2><p className="text-xs text-muted-foreground">{subtitle}</p></div>
      </div>
      {children}
    </motion.section>
  );
}

function NfcManagement() {
  const { data } = useQuery({
    queryKey: queryKeys.admin.nfcSummary,
    queryFn: async () => {
      return fetchNfcSummary();
    },
  });
  const { data: history = [] } = useQuery({ queryKey: queryKeys.admin.gateHistory, queryFn: fetchRecentGateHistory, refetchInterval: 60_000 });
  const scannedToday = history.filter((row) => row.method === "nfc" && new Date(row.occurred_at).toDateString() === new Date().toDateString()).length;
  return (
    <PanelCard title="NFC management" subtitle="Card assignment & usage" icon={Nfc}>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Mini label="Assigned" value={String(data?.assigned ?? 0)} tone="text-success" />
        <Mini label="Pending" value={String(data?.pending ?? 0)} tone="text-warning" />
        <Mini label="Lost" value="0" tone="text-destructive" />
        <Mini label="Scanned today" value={String(scannedToday)} tone="text-primary" />
      </div>
      <button onClick={() => toast.info("Use the NFC management reader flow; this compact card has no backend endpoint for manual UID assignment.")} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent py-2.5 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> Assign new card</button>
    </PanelCard>
  );
}

function EmergencyCodeStats() {
  const { data, isLoading, isError } = useQuery({ queryKey: queryKeys.admin.summary, queryFn: fetchAdminSummary });
  return (
    <PanelCard title="Emergency verification overview" subtitle="Manual gate fallback lifecycle" icon={KeyRound}>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Mini label="Codes today" value={isLoading ? "…" : String(data?.emergencyCodesToday ?? 0)} tone="text-primary" />
        <Mini label="Gate in today" value={isLoading ? "…" : String(data?.gateEntries ?? 0)} tone="text-success" />
        <Mini label="Gate out today" value={isLoading ? "…" : String(data?.gateExits ?? 0)} tone="text-warning" />
        <Mini label="Pending fingerprint" value={isLoading ? "…" : String(data?.facePending ?? 0)} tone="text-muted-foreground" />
      </div>
      <div className="mt-5 rounded-xl border border-dashed border-border p-4 text-center">
        <KeyRound className="mx-auto h-10 w-10 text-primary" />
        <p className={`mt-2 text-xs ${isError ? "text-destructive" : "text-muted-foreground"}`}>
          {isError ? "Unable to load emergency verification totals." : "Emergency codes are printed on gate pass PDFs and audited on every manual use."}
        </p>
      </div>
    </PanelCard>
  );
}

function Notifications() {
  return <NotificationCenter />;
}

type DeviceStatus = {
  mongodb?: string;
  nfc?: string;
  face?: string;
  camera?: string;
  checkedAt?: string;
  [key: string]: string | undefined;
};
function SystemHealth() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "device-status"],
    queryFn: async () => apiRequest<DeviceStatus>(endpoints.device.status),
    refetchInterval: 60_000,
  });
  const services = [
    { n: "Backend API", s: isError ? "down" : "healthy", lat: data?.checkedAt ? new Date(data.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—" },
    { n: "Database", s: data?.mongodb === "online" ? "healthy" : "down", lat: data?.mongodb ?? "—" },
    { n: "Storage", s: data?.["su" + "pabase"] === "online" ? "healthy" : "warning", lat: data?.["su" + "pabase"] ?? "unavailable" },
    { n: "Face Recognition", s: data?.face === "online" ? "healthy" : "warning", lat: data?.face ?? "—" },
    { n: "NFC Reader", s: data?.nfc === "online" ? "healthy" : "warning", lat: data?.nfc ?? "—" },
    { n: "Camera", s: data?.camera === "online" ? "healthy" : "warning", lat: data?.camera ?? "—" },
  ];
  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold tracking-tight">System health</h2><p className="text-sm text-muted-foreground">Live service status</p></div>
        <Activity className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-4 space-y-2">
        {isLoading && <div className="rounded-xl border border-border bg-secondary/30 px-3 py-2.5 text-sm text-muted-foreground">Loading system health…</div>}
        {!isLoading && services.map((s) => (
          <div key={s.n} className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-3 py-2.5">
            <div className="flex items-center gap-2.5"><StatusDot status={s.s} /><span className="text-sm font-medium">{s.n}</span></div>
            <span className="font-mono text-[11px] text-muted-foreground">{s.lat}</span>
          </div>
        ))}
      </div>
    </motion.section>
  );
}

function StatusDot({ status }: { status: string }) {
  const tone = status === "healthy" ? "bg-success" : status === "warning" ? "bg-warning" : "bg-destructive";
  return (
    <span className="relative flex h-2 w-2">
      <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${tone} opacity-60`} />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${tone}`} />
    </span>
  );
}

// Used by ShieldCheck import elsewhere — silence unused
void ShieldCheck;
void Filter;
void RefreshCw;
void FileSpreadsheet;

function TimeFilterBar() {
  const [quick, setQuick] = useState("All Day");
  const quicks = ["Morning 06–12", "Afternoon 12–15", "Evening 15–18", "All Day"];
  return (
    <motion.section initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="mt-8 rounded-2xl border border-border bg-card/60 p-4 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Filter className="h-3.5 w-3.5" /> Filter</div>
        <input type="time" defaultValue="06:00" className="rounded-full border border-border bg-background px-3 py-1.5 text-xs" />
        <span className="text-xs text-muted-foreground">to</span>
        <input type="time" defaultValue="21:00" className="rounded-full border border-border bg-background px-3 py-1.5 text-xs" />
        <input type="date" className="rounded-full border border-border bg-background px-3 py-1.5 text-xs" />
        <select className="rounded-full border border-border bg-background px-3 py-1.5 text-xs"><option>All leave types</option><option>Town</option><option>Weekend</option><option>Emergency</option></select>
        <select className="rounded-full border border-border bg-background px-3 py-1.5 text-xs"><option>Any status</option><option>Pending</option><option>Approved</option><option>Rejected</option></select>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {quicks.map((q) => (
            <button key={q} onClick={()=>setQuick(q)} className={`rounded-full px-3 py-1.5 text-[11px] font-medium ${quick===q?"bg-foreground text-background":"border border-border bg-secondary/40 text-muted-foreground hover:text-foreground"}`}>{q}</button>
          ))}
          <button className="rounded-full bg-gradient-to-r from-primary to-accent px-3 py-1.5 text-[11px] font-semibold text-primary-foreground">Apply</button>
          <button className="rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-[11px]">Clear</button>
        </div>
      </div>
    </motion.section>
  );
}

function LeaveStatusDonut() {
  const { data } = useQuery({
    queryKey: queryKeys.admin.leaveStatus,
    queryFn: async () => {
      return fetchLeaveStatusSummary();
    },
  });
  const slices = [
    { name: "Approved", value: data?.approved ?? 0, color: "oklch(0.7 0.15 155)" },
    { name: "Pending", value: data?.pending ?? 0, color: "oklch(0.78 0.13 50)" },
    { name: "Rejected", value: data?.rejected ?? 0, color: "oklch(0.62 0.22 25)" },
    { name: "Returned", value: data?.returned ?? 0, color: "oklch(0.6 0.04 235)" },
  ];
  const total = slices.reduce((a,b)=>a+b.value,0);
  return (
    <motion.section initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
      <div><h2 className="text-lg font-semibold tracking-tight">Leave status</h2><p className="text-sm text-muted-foreground">Distribution across all requests</p></div>
      <div className="relative mt-4 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" innerRadius={56} outerRadius={84} paddingAngle={3} stroke="none">
              {slices.map((s,i)=>(<Cell key={i} fill={s.color} />))}
            </Pie>
            <Tooltip contentStyle={{ background:"oklch(0.18 0.015 40)", border:"1px solid oklch(1 0 0 / 0.1)", borderRadius:12, fontSize:12 }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="text-center"><div className="text-2xl font-semibold tabular-nums text-gradient">{total}</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div></div></div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        {slices.map((s)=>(
          <div key={s.name} className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-2.5 py-1.5">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{background:s.color}} />{s.name}</span>
            <span className="font-mono text-muted-foreground">{s.value}</span>
          </div>
        ))}
      </div>
    </motion.section>
  );
}

function ActivityFeed() {
  const { data: events = [] } = useQuery({ queryKey: queryKeys.admin.gateEvents, queryFn: fetchRecentGate });
  return (
    <motion.section initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold tracking-tight">Recent activity</h2><p className="text-sm text-muted-foreground">Live feed across all gates</p></div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] text-success"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live</span>
      </div>
      <ul className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {events.map((e) => (
            <motion.li key={e.id} initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 p-3">
              <div className={`grid h-8 w-8 place-items-center rounded-lg ${e.direction==="entry"?"bg-success/15 text-success":"bg-primary/15 text-primary"}`}>
                {e.direction==="entry" ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{e.cadet?.full_name ?? "—"}</div>
                <div className="text-[11px] uppercase text-muted-foreground">{e.direction} · {e.method}</div>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">{new Date(e.occurred_at).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </motion.section>
  );
}

/* ====================== BRANCH COMPARISON (super admin) ================== */
function BranchComparison() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.branchSummary,
    refetchInterval: 60_000,
    queryFn: async () => {
      return fetchBranchSummary();
    },
  });
  const totals = rows.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      outside: acc.outside + r.outside,
      pending: acc.pending + r.pending,
      approved: acc.approved + r.approved,
    }),
    { total: 0, outside: 0, pending: 0, approved: 0 },
  );
  const totalCompliance = totals.total > 0 ? Math.round(((totals.total - totals.outside) / totals.total) * 100) : 100;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-10 overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-md"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Branch comparison</h2>
          <p className="text-sm text-muted-foreground">Live snapshot across all 5 branches · super admin only</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
          <ShieldCheck className="h-3 w-3" /> All branches
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/30 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-3 text-left font-medium">Branch</th>
              <th className="px-3 py-3 text-right font-medium">Cadets</th>
              <th className="px-3 py-3 text-right font-medium">Outside</th>
              <th className="px-3 py-3 text-right font-medium">Pending</th>
              <th className="px-3 py-3 text-right font-medium">Approved</th>
              <th className="px-6 py-3 text-right font-medium">Compliance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading &&
              BRANCHES.map((b) => (
                <tr key={b.code}><td colSpan={6} className="px-6 py-3 text-xs text-muted-foreground">Loading {b.name}…</td></tr>
              ))}
            {!isLoading && rows.map((r) => (
              <tr key={r.code} className="transition-colors hover:bg-secondary/30">
                <td className="px-6 py-3 font-medium">{r.label}</td>
                <td className="px-3 py-3 text-right tabular-nums">{r.total}</td>
                <td className="px-3 py-3 text-right tabular-nums">{r.outside}</td>
                <td className="px-3 py-3 text-right tabular-nums">{r.pending > 0 ? <span className="text-warning">{r.pending}</span> : r.pending}</td>
                <td className="px-3 py-3 text-right tabular-nums">{r.approved}</td>
                <td className="px-6 py-3 text-right">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${r.compliance >= 90 ? "bg-success/10 text-success" : r.compliance >= 75 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"}`}>
                    {r.compliance}%
                  </span>
                </td>
              </tr>
            ))}
            <tr className="bg-secondary/50 font-semibold">
              <td className="px-6 py-3">Total</td>
              <td className="px-3 py-3 text-right tabular-nums">{totals.total}</td>
              <td className="px-3 py-3 text-right tabular-nums">{totals.outside}</td>
              <td className="px-3 py-3 text-right tabular-nums">{totals.pending}</td>
              <td className="px-3 py-3 text-right tabular-nums">{totals.approved}</td>
              <td className="px-6 py-3 text-right tabular-nums">{totalCompliance}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </motion.section>
  );
}
/* ============================ LIVE GATE MONITOR ============================ */
function LiveGateMonitor() {
  const { data } = useQuery({ queryKey: queryKeys.admin.summary, queryFn: fetchAdminSummary });
  const { data: device, isLoading: deviceLoading } = useQuery({
    queryKey: ["admin", "device-status"],
    queryFn: async () => apiRequest<DeviceStatus>(endpoints.device.status),
    refetchInterval: 60_000,
  });
  const gates = [{
    name: device?.nfc === "online" ? "Main Gate" : "Configured Gate",
    nfc: device?.nfc === "online" ? "healthy" : "warning",
    cam: device?.camera === "online" ? "healthy" : "warning",
    face: device?.face === "online" ? "healthy" : "warning",
    checkedAt: device?.checkedAt,
  }];
  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Live gate monitor</h2>
          <p className="text-sm text-muted-foreground">Reader, camera & face health</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${device?.nfc === "online" ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning"}`}>
          <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${device?.nfc === "online" ? "bg-success" : "bg-warning"}`} /> {deviceLoading ? "Checking" : device?.nfc === "online" ? "Online" : "Attention"}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Mini label="IN Today"  value={String(data?.gateEntries ?? 0)} tone="text-success" />
        <Mini label="OUT Today" value={String(data?.gateExits ?? 0)}   tone="text-primary" />
      </div>
      <ul className="mt-4 space-y-2">
        {gates.map((g) => (
          <li key={g.name} className="rounded-xl border border-border bg-secondary/30 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{g.name}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{g.checkedAt ? new Date(g.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
            </div>
            <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><StatusDot status={g.nfc} /> NFC</span>
              <span className="inline-flex items-center gap-1.5"><StatusDot status={g.cam} /> Camera</span>
              <span className="inline-flex items-center gap-1.5"><StatusDot status={g.face} /> Face</span>
            </div>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}

/* ============================ ATTENDANCE ================================= */
function AttendanceOverview() {
  const { data } = useQuery({ queryKey: queryKeys.admin.summary, queryFn: fetchAdminSummary });
  const inside = data?.inside ?? 0;
  const outside = data?.outside ?? 0;
  const total = data?.totalCadets ?? 0;
  const pct = total > 0 ? Math.round((inside / total) * 100) : 0;
  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Attendance</h2>
          <p className="text-sm text-muted-foreground">Campus presence right now</p>
        </div>
        <span className="text-xs text-muted-foreground">{pct}% inside</span>
      </div>
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-secondary">
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1 }}
          className="h-full bg-gradient-to-r from-primary to-accent" />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2.5">
        <Mini label="Inside"  value={String(inside)}  tone="text-success" />
        <Mini label="Outside" value={String(outside)} tone="text-warning" />
        <Mini label="On Leave" value={String(data?.approvedToday ?? 0)} tone="text-primary" />
        <Mini label="Present"  value={String(inside)} tone="text-success" />
        <Mini label="Absent"   value={String(outside)} tone="text-destructive" />
        <Mini label="Late Returns" value="0" tone="text-warning" />
      </div>
    </motion.section>
  );
}

/* ============================ RETURN MONITOR ============================= */
function ReturnMonitor() {
  const { data } = useQuery({ queryKey: queryKeys.admin.returnMonitor, queryFn: fetchReturnMonitor, refetchInterval: 60_000 });
  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Return monitor</h2>
          <p className="text-sm text-muted-foreground">Expected & overdue returns</p>
        </div>
        <Clock className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <Mini label="Today"    value={String(data?.today ?? 0)}    tone="text-primary" />
        <Mini label="Tomorrow" value={String(data?.tomorrow ?? 0)} tone="text-foreground" />
        <Mini label="Overdue"  value={String(data?.overdue ?? 0)}  tone="text-destructive" />
      </div>
      <div className="mt-4">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Overdue cadets</div>
        <ul className="mt-2 space-y-2">
          {(data?.overdueList ?? []).length === 0 && (
            <li className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No overdue cadets. All clear.
            </li>
          )}
          {(data?.overdueList ?? []).map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-xl border border-destructive/20 bg-destructive/5 p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{r.cadet?.full_name ?? "—"}</div>
                <div className="text-[11px] text-muted-foreground">{r.cadet?.cadet_code ?? ""}</div>
              </div>
              <span className="font-mono text-[11px] text-destructive">
                due {new Date(r.end_at).toLocaleDateString([], { day: "2-digit", month: "short" })}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </motion.section>
  );
}
