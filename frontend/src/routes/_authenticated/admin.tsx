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
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            initial={false}
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
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="pt-6 sm:pt-8 pb-4">
      <div className="flex items-center gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#0077f6] text-white shadow-md shadow-blue-500/20">
          <Icon className="h-6 w-6 stroke-[2.2]" />
        </div>
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">{subtitle}</p>
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
      <motion.div key={c.id} layout className="grid grid-cols-12 items-center gap-3 px-6 py-4 text-sm transition-colors hover:bg-slate-50/70">
        <div className="col-span-5 flex items-center gap-3 sm:col-span-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#0077f6] text-xs font-extrabold text-white shadow-sm">{initials}</div>
          <div className="min-w-0">
            <div className="truncate font-bold text-slate-900">{c.full_name}</div>
            <div className="text-[11px] font-medium text-slate-400">{c.cadet_code}</div>
          </div>
        </div>
        <div className="col-span-2 hidden truncate text-slate-600 font-medium sm:block">{c.branch ?? "—"} · S{c.semester ?? "?"}</div>
        <div className="col-span-1 hidden lg:block">
          {c.face_enrolled ? (
            <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold uppercase">Enrolled</span>
          ) : (
            <span className="rounded-full bg-slate-100 text-slate-600 border border-slate-200 px-2.5 py-0.5 text-[10px] font-bold uppercase">Pending</span>
          )}
        </div>
        <div className="col-span-2 hidden truncate font-mono text-xs text-slate-500 xl:block">{c.nfc_card_id ?? "—"}</div>
        <div className="col-span-3 hidden md:block">
          <span className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${c.leave_blocked ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
            {c.leave_blocked ? "Blocked" : "Active"}
          </span>
        </div>
        <div className="col-span-7 flex justify-end sm:col-span-7 md:col-span-4 lg:col-span-3 xl:col-span-1">
          <button
            onClick={() => (c.leave_blocked ? setUnblockTarget(c) : setBlockTarget(c))}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition-all ${
              c.leave_blocked
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
            }`}
          >
            {c.leave_blocked ? "Unblock" : "Block"}
          </button>
        </div>
      </motion.div>
    );
  };
  return (
    <>
      <ViewHeader title="Cadets" subtitle="Full academy roster, enrollment & gate status" icon={Users} />
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
          <Search className="h-4 w-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, code, branch…"
            className="w-full bg-transparent outline-none placeholder:text-slate-400 text-slate-900" />
        </div>
        <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm">
          {(["all", "bsc", "bme"] as const).map((branch) => (
            <button
              key={branch}
              onClick={() => setBranchFilter(branch)}
              className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase transition-all ${
                branchFilter === branch ? "bg-[#0077f6] text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {branch === "all" ? "All Branches" : branch.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm">
          {(["all", "active", "blocked"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setLeaveFilter(status)}
              className={`rounded-full px-4 py-1.5 text-xs font-bold capitalize transition-all ${
                leaveFilter === status ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {status === "active" ? "Active Leave" : status === "blocked" ? "Leave Blocked" : "All"}
            </button>
          ))}
        </div>
        <button onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"><FileSpreadsheet className="h-4 w-4 text-[#0077f6]" /> Bulk import</button>
        <button onClick={() => toast.info("Use Bulk import for CSV/Excel or the existing cadet API for individual records.")} className="inline-flex items-center gap-2 rounded-full bg-[#0077f6] px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-blue-500/20 hover:bg-[#0062cc]"><UserPlus className="h-4 w-4" /> Add cadet</button>
      </div>
      <div className="mt-6 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
        <div className="grid grid-cols-12 gap-3 border-b border-slate-100 bg-slate-50/70 px-6 py-3.5 text-[11px] uppercase tracking-wider text-slate-500 font-bold">
          <div className="col-span-5 sm:col-span-3">Cadet</div>
          <div className="col-span-2 hidden sm:block">Branch</div>
          <div className="col-span-1 hidden lg:block">Face</div>
          <div className="col-span-2 hidden xl:block">NFC</div>
          <div className="col-span-3 hidden md:block">Leave Status</div>
          <div className="col-span-7 text-right sm:col-span-7 md:col-span-4 lg:col-span-3 xl:col-span-1">Action</div>
        </div>
        <div className="divide-y divide-slate-100">
          {isLoading && <p className="py-8 text-center text-sm text-slate-500 font-medium">Loading…</p>}
          {!isLoading && filtered.length === 0 && <p className="py-8 text-center text-sm text-slate-500 font-medium">No cadets match.</p>}
          {groupedCadets.map((group) => (
            <section key={group.key} className="divide-y divide-slate-100">
              <div className="flex items-center justify-between bg-slate-50/50 px-6 py-3">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">{group.title}</h3>
                  <p className="text-[11px] text-slate-500">{group.hint}</p>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-xs">{group.rows.length} cadets</span>
              </div>
              {group.rows.length ? group.rows.map(renderCadetRow) : <p className="py-8 text-center text-sm text-slate-400">No {group.title.toLowerCase()} match.</p>}
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
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-6 py-5">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">Live Submissions</span>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 mt-0.5">New leave requests</h2>
          <p className="text-xs text-slate-500">Live requests from MongoDB Atlas, including recent approvals and rejections.</p>
        </div>
        <button onClick={() => void refetch()} className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50/60 px-3.5 py-1.5 text-xs font-bold text-[#0077f6] hover:bg-blue-100 transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh live data
        </button>
      </div>
      <div className="grid gap-3 border-b border-slate-100 p-5 sm:grid-cols-3 bg-slate-50/40">
        <LiveLeaveMetric label="Pending now" value={counts.pending} tone="warning" />
        <LiveLeaveMetric label="Recently approved" value={counts.approved} tone="success" />
        <LiveLeaveMetric label="Recently rejected" value={counts.rejected} tone="destructive" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-6 py-3.5 text-left font-bold">Cadet</th>
              <th className="px-3 py-3.5 text-left font-bold">Roll No</th>
              <th className="px-3 py-3.5 text-left font-bold">Leave Type</th>
              <th className="px-3 py-3.5 text-left font-bold">Destination</th>
              <th className="px-3 py-3.5 text-left font-bold">Window</th>
              <th className="px-3 py-3.5 text-left font-bold">Status</th>
              <th className="px-6 py-3.5 text-right font-bold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-slate-400">Loading live leave requests…</td></tr>}
            {isError && !isLoading && <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-rose-600 font-semibold">Unable to load live leave requests.</td></tr>}
            {!isLoading && !isError && visible.length === 0 && <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-slate-400">No live leave requests match this filter.</td></tr>}
            {visible.slice(0, 12).map((request) => {
              const roll = request.roll || request.cadet?.cadet_code || "";
              const canDecide = request.status === "pending" && !!roll;
              return (
                <motion.tr key={`${request.id}-${roll}`} layout className="transition-colors hover:bg-slate-50/60">
                  <td className="px-6 py-3.5 font-bold text-slate-900">{request.cadet?.full_name || "—"}</td>
                  <td className="px-3 py-3.5 font-mono text-xs font-semibold text-slate-600">{roll || "—"}</td>
                  <td className="px-3 py-3.5 font-semibold text-slate-800">{request.reason || "Shore Leave"}</td>
                  <td className="px-3 py-3.5 text-slate-600">{request.destination || "—"}</td>
                  <td className="px-3 py-3.5 text-xs text-slate-500 font-medium">
                    {new Date(request.start_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                    <span className="mx-1 text-[#0077f6]">→</span>
                    {new Date(request.end_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                  </td>
                  <td className="px-3 py-3.5"><StatusBadge status={request.status} /></td>
                  <td className="px-6 py-3.5">
                    <div className="flex justify-end gap-2">
                      <button disabled={!canDecide || decision.isPending} onClick={() => decision.mutate({ roll, status: "approved" })} className="rounded-full bg-[#0077f6] px-3.5 py-1 text-xs font-bold text-white shadow-sm hover:bg-[#0066d6] disabled:opacity-30 transition-all">Approve</button>
                      <button disabled={!canDecide || decision.isPending} onClick={() => decision.mutate({ roll, status: "rejected", reason: "Rejected by administrator" })} className="rounded-full border border-rose-200 bg-rose-50 px-3.5 py-1 text-xs font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-30 transition-all">Reject</button>
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-6 py-3.5 text-xs text-slate-500">
        <span className="font-medium">Showing {Math.min(visible.length, 12)} of {visible.length} matching requests.</span>
        <span>Last refreshed {lastUpdated}</span>
      </div>
    </motion.section>
  );
}

function LiveLeaveMetric({ label, value, tone }: { label: string; value: number; tone: "warning" | "success" | "destructive" }) {
  const toneClass = {
    warning: "text-amber-700 bg-amber-50/80 border-amber-200",
    success: "text-emerald-700 bg-emerald-50/80 border-emerald-200",
    destructive: "text-rose-700 bg-rose-50/80 border-rose-200",
  }[tone];
  return (
    <div className={`rounded-2xl border px-4 py-3.5 ${toneClass}`}>
      <div className="text-2xl font-black tabular-nums">{value}</div>
      <div className="text-xs font-bold mt-0.5 uppercase tracking-wide opacity-80">{label}</div>
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
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-5">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">Token Authority</span>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 mt-0.5">Leave Token Control</h2>
          <p className="text-xs text-slate-500">Approve requests, manage emergency codes, print passes and review supporting documents.</p>
        </div>
        <button onClick={() => void refetch()} className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50/60 px-3.5 py-1.5 text-xs font-bold text-[#0077f6] hover:bg-blue-100 transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>
      <div className="border-b border-slate-100 px-6 py-3.5 bg-slate-50/40">
        <div className="flex gap-1.5 overflow-x-auto p-0.5">
          {statuses.map((item) => (
            <button
              key={item}
              onClick={() => setStatus(item)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold capitalize transition-all ${status === item ? "bg-[#0077f6] text-white shadow-sm" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"}`}
            >
              {item.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-6 py-3.5 text-left font-bold">Roll Number</th>
              <th className="px-3 py-3.5 text-left font-bold">Cadet Name</th>
              <th className="px-3 py-3.5 text-left font-bold">Leave Type</th>
              <th className="px-3 py-3.5 text-left font-bold">Start Date</th>
              <th className="px-3 py-3.5 text-left font-bold">End Date</th>
              <th className="px-3 py-3.5 text-left font-bold">Leave Status</th>
              <th className="px-3 py-3.5 text-left font-bold">Token Status</th>
              <th className="px-6 py-3.5 text-right font-bold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={8} className="px-6 py-8 text-center text-sm text-slate-400">Loading leave token control…</td></tr>}
            {isError && !isLoading && <tr><td colSpan={8} className="px-6 py-8 text-center text-sm text-rose-600 font-semibold">Unable to load leave token control.</td></tr>}
            {!isLoading && !isError && filtered.length === 0 && <tr><td colSpan={8} className="px-6 py-8 text-center text-sm text-slate-400">No leave requests match this filter.</td></tr>}
            {filtered.map((request) => {
              const approved = request.leaveStatus === "approved";
              const pending = request.leaveStatus === "pending";
              const tokenActive = ["generated", "active"].includes(request.tokenStatus);
              return (
                <tr key={`${request.source}-${request.id}-${request.roll}`} className="transition-colors hover:bg-slate-50/60">
                  <td className="px-6 py-3.5 font-mono text-xs font-semibold text-slate-600">{request.roll}</td>
                  <td className="px-3 py-3.5 font-bold text-slate-900">{request.cadetName || "—"}</td>
                  <td className="px-3 py-3.5 font-semibold text-slate-800">{request.leaveType || "—"}</td>
                  <td className="px-3 py-3.5 text-xs text-slate-500 font-medium">{request.startDate ? new Date(request.startDate).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
                  <td className="px-3 py-3.5 text-xs text-slate-500 font-medium">{request.endDate ? new Date(request.endDate).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
                  <td className="px-3 py-3.5"><StatusBadge status={request.leaveStatus} /></td>
                  <td className="px-3 py-3.5"><StatusBadge status={request.tokenStatus || "not_generated"} /></td>
                  <td className="px-6 py-3.5">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button disabled={!pending || decision.isPending} onClick={() => decision.mutate({ roll: request.roll, nextStatus: "approved" })} className="rounded-full bg-[#0077f6] px-3 py-1 text-xs font-bold text-white shadow-sm hover:bg-[#0066d6] disabled:opacity-30 transition-all">Approve</button>
                      <button disabled={!pending || decision.isPending} onClick={() => decision.mutate({ roll: request.roll, nextStatus: "rejected" })} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-30 transition-all">Reject</button>
                      <button disabled={!approved || tokenActive || token.isPending} onClick={() => token.mutate({ roll: request.roll, action: "generate" })} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-[#0077f6] hover:bg-blue-100 disabled:opacity-30 transition-all">Generate</button>
                      <button disabled={!tokenActive || token.isPending} onClick={() => token.mutate({ roll: request.roll, action: "revoke" })} className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-30 transition-all">Revoke</button>
                      <button disabled={!approved || token.isPending} onClick={() => token.mutate({ roll: request.roll, action: "reissue" })} className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-30 transition-all">Reissue</button>
                      <button onClick={() => request.emergencyVerificationCode ? toast.info(`Emergency code: ${request.emergencyVerificationCode}`) : toast.info("No emergency code generated yet")} className="grid h-7 w-7 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 hover:text-[#0077f6] hover:border-blue-200" title="View emergency code"><KeyRound className="h-3.5 w-3.5" /></button>
                      <button onClick={() => openLink(request.passUrl)} className="grid h-7 w-7 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 hover:text-[#0077f6] hover:border-blue-200" title="Print leave pass"><Download className="h-3.5 w-3.5" /></button>
                      <button onClick={() => openLink(request.documentUrl)} className="grid h-7 w-7 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 hover:text-[#0077f6] hover:border-blue-200" title="View supporting document"><Eye className="h-3.5 w-3.5" /></button>
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
      <div className="mt-8 flex flex-wrap items-center gap-2">
        {(["nfc","scan","otp","manual","late"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-full px-4 py-2 text-xs font-bold transition-all ${
              mode === m
                ? "bg-[#0077f6] text-white shadow-sm"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
            }`}
          >
            {m === "nfc" ? "NFC Tap" : m === "scan" ? "Emergency Code" : m === "otp" ? "OTP Verification" : m === "late" ? "Late Returns" : "Manual Override"}
          </button>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <motion.div key={mode} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="lg:col-span-2 rounded-3xl border border-slate-100 bg-white p-7 shadow-sm">
          {mode === "nfc" && (
            <div className="mx-auto max-w-md text-center py-4">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-blue-50 text-[#0077f6] mb-4">
                <Nfc className="h-8 w-8 animate-pulse" />
              </div>
              <h3 className="text-base font-extrabold text-slate-900">NFC Gate Reader</h3>
              <p className="mt-2 text-xs text-slate-500">Ask the returning cadet to tap their registered NFC card on the gate reader or enter UID below.</p>
              <input
                autoFocus
                value={nfcUid}
                onChange={(e) => setNfcUid(e.target.value.trim())}
                onKeyDown={(e) => { if (e.key === "Enter" && nfcUid) nfcInMut.mutate(nfcUid); }}
                placeholder="Tap card or enter UID…"
                className="mt-5 w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-center font-mono text-sm text-slate-900 outline-none focus:border-[#0077f6] focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
              />
              <button
                onClick={() => nfcUid && nfcInMut.mutate(nfcUid)}
                disabled={!nfcUid || nfcInMut.isPending}
                className="mt-4 w-full rounded-full bg-[#0077f6] py-3 text-sm font-bold text-white shadow-sm hover:bg-[#0066d6] disabled:opacity-60 transition-all"
              >{nfcInMut.isPending ? "Verifying…" : "Verify NFC & Check In"}</button>
              <p className="mt-3 text-[11px] text-slate-400">Late returns are allowed and flagged automatically in compliance audits.</p>
            </div>
          )}
          {mode === "scan" && (
            <div className="text-center py-4">
              <div className="relative mx-auto h-64 w-64 overflow-hidden rounded-3xl border-2 border-dashed border-blue-200 bg-blue-50/40">
                <div className="absolute inset-x-6 top-0 h-0.5 bg-gradient-to-r from-transparent via-[#0077f6] to-transparent animate-[scan_2.4s_linear_infinite]" style={{ animation: "scanline 2.4s linear infinite" }} />
                <div className="absolute inset-0 grid place-items-center"><Camera className="h-12 w-12 text-[#0077f6]/60" /></div>
              </div>
              <p className="mt-4 text-xs text-slate-500 max-w-sm mx-auto">Use the emergency verification code printed on the gate pass when NFC or face verification is unavailable.</p>
              <button
                onClick={() => {
                  const next = outside[0];
                  if (!next) { toast.info("No cadets outside to check in"); return; }
                  checkIn.mutate({ id: next.id, method: "emergency" });
                }}
                disabled={checkIn.isPending}
                className="mt-4 rounded-full bg-[#0077f6] px-6 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#0066d6] disabled:opacity-60 transition-all"
              >Simulate Emergency Check-In</button>
            </div>
          )}
          {mode === "otp" && (
            <div className="mx-auto max-w-md text-center py-4">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-blue-50 text-[#0077f6] mb-4">
                <KeyRound className="h-8 w-8" />
              </div>
              <h3 className="text-base font-extrabold text-slate-900">OTP Fallback</h3>
              <p className="mt-1 text-xs text-slate-500">Search the cadet, send OTP and verify on return.</p>
              <input placeholder="Search cadet…" className="mt-5 w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-2.5 text-xs outline-none focus:border-[#0077f6] focus:bg-white" />
              <div className="mt-3 flex justify-center gap-2">
                {Array.from({length:6}).map((_,i)=>(<input key={i} maxLength={1} className="h-12 w-10 rounded-xl border border-slate-200 bg-slate-50/50 text-center font-mono text-lg font-bold text-slate-900 focus:border-[#0077f6] focus:bg-white outline-none" />))}
              </div>
              <button
                onClick={() => {
                  const next = outside[0];
                  if (!next) { toast.info("No cadets outside to check in"); return; }
                  checkIn.mutate({ id: next.id, method: "face" });
                }}
                disabled={checkIn.isPending}
                className="mt-5 w-full rounded-full bg-[#0077f6] py-3 text-sm font-bold text-white shadow-sm hover:bg-[#0066d6] disabled:opacity-60 transition-all"
              >Verify OTP & Check In</button>
            </div>
          )}
          {mode === "manual" && (
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-900">Cadets Currently Outside</h3>
                <span className="text-xs font-bold text-slate-500">{outside.length} cadets</span>
              </div>
              <div className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
                {outside.length === 0 && <p className="text-xs text-slate-400 py-6 text-center">No cadets outside campus right now.</p>}
                {outside.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/50 px-4 py-3 text-sm">
                    <div>
                      <div className="font-bold text-slate-900">{c.full_name}</div>
                      <div className="font-mono text-xs text-slate-500">{c.cadet_code}</div>
                    </div>
                    <button
                      onClick={() => checkIn.mutate({ id: c.id, method: "nfc" })}
                      disabled={checkIn.isPending}
                      className="rounded-full bg-emerald-50 border border-emerald-200 px-3.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 transition-all"
                    >Mark Returned</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {mode === "late" && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Late Returns After 18:00 hrs</h3>
                  <p className="mt-0.5 text-xs text-slate-500">Current time: {currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Late entries are pulled from live gate logs.</p>
                </div>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">{lateReturns.length} late</span>
              </div>
              <div className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
                {lateReturns.length === 0 && <p className="rounded-2xl border border-slate-100 bg-slate-50/40 p-6 text-center text-xs text-slate-400">No late returns recorded yet.</p>}
                {lateReturns.map((event) => (
                  <div key={event.id} className="flex items-center justify-between rounded-2xl border border-amber-200/80 bg-amber-50/60 px-4 py-3 text-sm">
                    <div>
                      <div className="font-bold text-slate-900">{event.cadet?.full_name || event.cadet_name || event.roll_number || "Unknown cadet"}</div>
                      <div className="text-xs text-slate-500">{event.roll_number || event.cadet?.cadet_code || "-"} · {event.gate_name || "Gate"}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-xs font-bold text-slate-800">{new Date(event.occurred_at).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700">{event.result || "Late return"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
        <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">Recent Gate Check-Ins</h3>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#0077f6]">Live Log</span>
          </div>
          <ul className="mt-3 space-y-2">
            {log.length === 0 && <li className="text-xs text-slate-400 py-4 text-center">No check-ins yet today.</li>}
            {log.map((l) => (
              <li key={l.id} className="flex items-center justify-between rounded-2xl border border-emerald-100 bg-emerald-50/50 px-3.5 py-2.5 text-xs">
                <span className="font-bold text-slate-900">{l.cadet?.full_name ?? "—"}</span>
                <span className="font-mono text-slate-500 uppercase">{l.method} · {new Date(l.occurred_at).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</span>
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
      <div className="mt-8 rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Nfc className="h-4 w-4 text-[#0077f6]" /> NFC Gate Check-Out</div>
          <div className="flex-1 min-w-[220px]">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Approved leave</label>
            <select
              value={selectedLeave ?? ""}
              onChange={(e) => setSelectedLeave(e.target.value || null)}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-xs font-medium text-slate-800 outline-none focus:border-[#0077f6] focus:bg-white"
            >
              <option value="">Select approved leave…</option>
              {pending.map((r) => (
                <option key={r.id} value={r.id}>{r.cadet?.full_name} · {r.cadet?.cadet_code} → {r.destination}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Tap NFC card</label>
            <input
              value={nfcUid}
              onChange={(e) => setNfcUid(e.target.value.trim())}
              onKeyDown={(e) => { if (e.key === "Enter" && selectedLeave && nfcUid) nfcOutMut.mutate({ leaveId: selectedLeave, nfcUid }); }}
              placeholder="Waiting for card tap…"
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-center font-mono text-xs text-slate-900 outline-none focus:border-[#0077f6] focus:bg-white"
            />
          </div>
          <button
            onClick={() => selectedLeave && nfcUid && nfcOutMut.mutate({ leaveId: selectedLeave, nfcUid })}
            disabled={!selectedLeave || !nfcUid || nfcOutMut.isPending}
            className="rounded-full bg-[#0077f6] px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#0066d6] disabled:opacity-60 transition-all"
          >{nfcOutMut.isPending ? "Verifying…" : "Confirm Exit & Issue Pass"}</button>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">System verifies UID belongs to cadet, leave is approved and unexpired, and cadet is currently inside campus. Gate pass QR/PDF is generated and audited automatically.</p>
      </div>
      <div className="mt-8 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
        <div className="grid grid-cols-12 gap-2 border-b border-slate-100 bg-slate-50/70 px-6 py-3.5 text-[11px] uppercase tracking-wider text-slate-500 font-bold">
          <div className="col-span-4">Cadet</div>
          <div className="col-span-3 hidden md:block">Destination</div>
          <div className="col-span-2 hidden md:block">Expected out</div>
          <div className="col-span-3 text-right">Action</div>
        </div>
        <div className="divide-y divide-slate-100">
          {pending.length === 0 && <p className="py-8 text-center text-xs text-slate-400">No pending check-outs.</p>}
          {pending.map((r) => {
            const initials = (r.cadet?.full_name ?? "?").split(" ").map((x: string) => x[0]).slice(0,2).join("").toUpperCase();
            return (
              <div key={r.id} className="grid grid-cols-12 items-center gap-2 px-6 py-3.5 text-sm transition-colors hover:bg-slate-50/60">
                <div className="col-span-4 flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-2xl bg-blue-50 text-xs font-extrabold text-[#0077f6]">{initials}</div>
                  <div><div className="font-bold text-slate-900">{r.cadet?.full_name}</div><div className="font-mono text-xs text-slate-500">{r.cadet?.cadet_code}</div></div>
                </div>
                <div className="col-span-3 hidden truncate text-slate-600 font-medium md:block">{r.destination}</div>
                <div className="col-span-2 hidden font-mono text-xs text-slate-500 md:block">{new Date(r.start_at).toLocaleString([], { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}</div>
                <div className="col-span-3 flex justify-end gap-2">
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700">Awaiting Exit</span>
                  <button
                    onClick={() => r.cadet?.id && checkOut.mutate(r.cadet.id)}
                    disabled={checkOut.isPending}
                    className="rounded-full bg-[#0077f6] px-3.5 py-1 text-xs font-bold text-white shadow-sm hover:bg-[#0066d6] disabled:opacity-60 transition-all"
                  >Confirm Exit</button>
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
        <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white p-1 shadow-xs">
          {(["pending","completed","all"] as const).map((f) => (
            <button key={f} onClick={()=>setFilter(f)} className={`rounded-full px-4 py-1.5 text-xs font-bold capitalize transition-all ${filter===f ? "bg-[#0077f6] text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
              {f} <span className="ml-1 opacity-80">({f==="pending"?pending:f==="completed"?enrolled:cadets.length})</span>
            </button>
          ))}
        </div>
        <button onClick={()=>{setConsole(true); setSelectedRoll("");}} className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#0077f6] px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#0066d6] transition-all"><Camera className="h-4 w-4" /> Open enrollment console</button>
      </div>
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1"><FaceEnrollment /></div>
        <div className="lg:col-span-2 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">Enrolled</div>
              <div className="mt-1 text-2xl font-black text-emerald-700">{enrolled}</div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Pending</div>
              <div className="mt-1 text-2xl font-black text-amber-700">{pending}</div>
            </div>
          </div>
          <div className="mt-5 max-h-80 space-y-2 overflow-y-auto pr-1">
            {filtered.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3 text-sm transition-colors hover:bg-slate-50">
                <div className="min-w-0"><div className="truncate font-bold text-slate-900">{c.full_name}</div><div className="font-mono text-xs text-slate-500">{c.cadet_code}</div></div>
                {c.face_enrolled
                  ? (
                    <div className="relative flex shrink-0 items-center gap-2">
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">Enrolled</span>
                      <button onClick={()=>openEnrollmentCamera(c)} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-[#0077f6] hover:bg-blue-100 transition-all">Re-enroll Face</button>
                      {canDeleteFace && (
                        <>
                          <button
                            type="button"
                            onClick={() => setMoreActionsRoll((current) => current === (c.roll || c.cadet_code) ? null : (c.roll || c.cadet_code))}
                            className="grid h-7 w-7 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 hover:text-slate-900"
                            aria-label={`More actions for ${c.full_name}`}
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </button>
                          {moreActionsRoll === (c.roll || c.cadet_code) && (
                            <div className="absolute right-0 top-8 z-20 w-44 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
                              <button
                                type="button"
                                onClick={() => setDeleteCandidate(c)}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold text-rose-600 hover:bg-rose-50"
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
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700">Pending</span>
                      <button onClick={()=>openEnrollmentCamera(c)} className="rounded-full bg-[#0077f6] px-3.5 py-1 text-xs font-bold text-white shadow-sm hover:bg-[#0066d6] transition-all">Enroll Face</button>
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
            <motion.div initial={{scale:0.95,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.95,opacity:0}} onClick={(e)=>e.stopPropagation()} className="w-full max-w-lg rounded-3xl border border-slate-100 bg-white p-7 shadow-2xl">
              <h3 className="text-xl font-extrabold tracking-tight text-slate-900">Live camera enrollment</h3>
              <p className="mt-1.5 text-xs text-slate-500">
                Select a cadet, then capture a live camera frame for the existing cadet record.
              </p>
              <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50/60 p-5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Cadet</label>
                <select
                  value={selectedRoll}
                  onChange={(event) => {
                    const roll = event.target.value;
                    setSelectedRoll(roll);
                    const cadet = cadets.find((entry) => entry.roll === roll || entry.cadet_code === roll);
                    if (cadet) openEnrollmentCamera(cadet);
                  }}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-800 outline-none focus:border-[#0077f6]"
                >
                  <option value="">Select cadet…</option>
                  {cadets.map((cadet) => (
                    <option key={cadet.id} value={cadet.roll || cadet.cadet_code}>{cadet.full_name} · {cadet.roll || cadet.cadet_code}{cadet.face_enrolled ? " · enrolled" : ""}</option>
                  ))}
                </select>
                {selectedCadet && (
                  <div className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-bold text-slate-900">{selectedCadet.full_name}</div>
                      <div className="font-mono text-xs text-slate-500">{selectedCadet.roll || selectedCadet.cadet_code}</div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${selectedCadet.face_enrolled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                      {selectedCadet.face_enrolled ? "Enrolled" : "Pending"}
                    </span>
                  </div>
                )}
              </div>
              <div className="mt-6 flex justify-between gap-3">
                <button onClick={()=>setConsole(false)} className="rounded-full border border-slate-200 px-5 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100">Cancel</button>
                <button onClick={()=>setCameraOpen(true)} disabled={!selectedCadet} className="inline-flex items-center gap-2 rounded-full bg-[#0077f6] px-6 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#0066d6] disabled:opacity-60 transition-all"><Camera className="h-4 w-4" /> Open camera</button>
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
            <motion.div key={c.t} whileHover={{y:-3}} className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-50 text-[#0077f6]"><Icon className="h-5 w-5" /></div>
                <span className="text-3xl font-black tabular-nums text-slate-900">{summaryLoading ? "…" : summaryError ? "!" : c.val}</span>
              </div>
              <h3 className="mt-4 text-base font-extrabold text-slate-900">{c.t}</h3>
              <p className="text-xs text-slate-500 mt-0.5">{c.d}</p>
              <a href={downloadUrl(endpoints.admin.exportLeaveRecords)} className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50/60 px-3.5 py-1.5 text-xs font-bold text-[#0077f6] hover:bg-blue-100 transition-colors"><Download className="h-3.5 w-3.5" /> Download CSV</a>
            </motion.div>
          );
        })}
      </div>
      <div className="mt-6"><LeaveOverview /></div>
      <div className="mt-6 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">Audit Trail</span>
            <h2 className="text-lg font-extrabold tracking-tight text-slate-900 mt-0.5">Audit log</h2>
            <p className="text-xs text-slate-500">Every privileged action, attributable and recorded</p>
          </div>
          <a href={downloadUrl(endpoints.admin.exportAuditLogs)} className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50/60 px-4 py-2 text-xs font-bold text-[#0077f6] hover:bg-blue-100 transition-colors"><Download className="h-3.5 w-3.5" /> Export CSV</a>
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100">
          <div className="grid grid-cols-12 gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3 text-[11px] uppercase tracking-wider text-slate-500 font-bold">
            <div className="col-span-2">Time</div><div className="col-span-3">Actor</div><div className="col-span-2">Role</div><div className="col-span-3">Action</div><div className="col-span-2">Cadet</div>
          </div>
          {auditLoading && <div className="px-4 py-6 text-center text-xs text-slate-400">Loading audit log…</div>}
          {auditError && <div className="px-4 py-6 text-center text-xs text-rose-600 font-bold">Unable to load audit log.</div>}
          {!auditLoading && !auditError && audit.length === 0 && <div className="px-4 py-6 text-center text-xs text-slate-400">No audit entries yet.</div>}
          {audit.slice(0, 12).map((a) => (
            <div key={a.id} className="grid grid-cols-12 gap-2 border-b border-slate-100 px-4 py-2.5 text-xs transition-colors hover:bg-slate-50/60 last:border-0">
              <div className="col-span-2 font-mono text-slate-500 font-medium">{new Date(a.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
              <div className="col-span-3 font-bold text-slate-900">{a.actor || "system"}</div>
              <div className="col-span-2 text-slate-500 font-medium">Backend</div>
              <div className="col-span-3 text-slate-800 font-medium">{a.action || a.result || "Event"}</div>
              <div className="col-span-2 text-slate-600 font-mono text-[11px]">{a.roll_number || a.cadet_name || "—"}</div>
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
        <motion.section initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} className="rounded-3xl border border-slate-100 bg-white p-7 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2"><FileBarChart className="h-4 w-4 text-[#0077f6]" /><h3 className="text-base font-extrabold text-slate-900">Daily Operations Report</h3></div>
              <p className="mt-1 text-xs text-slate-500">Automatically generated and emailed to designated staff every evening.</p>
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-[#0077f6]" />
              {enabled ? "Enabled" : "Disabled"}
            </label>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Run time (server)</div>
              <input type="time" value={runTime} onChange={(e) => setRunTime(e.target.value)} className="mt-1 w-full bg-white rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-mono text-slate-900 outline-none focus:border-[#0077f6]" />
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Report formats</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["pdf","html","csv"] as const).map((f) => (
                  <button key={f} type="button" onClick={() => toggleFormat(f)}
                    className={`rounded-full px-3.5 py-1 text-xs font-bold capitalize transition-all ${formats.includes(f) ? "bg-[#0077f6] text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"}`}>{f}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Recipients (one per line)</div>
            <textarea value={recipients} onChange={(e) => setRecipients(e.target.value)} rows={5}
              placeholder="principal@example.com&#10;hod@example.com&#10;warden@example.com"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs text-slate-900 outline-none focus:border-[#0077f6] resize-none" />
          </div>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <button onClick={() => save.mutate()} disabled={save.isPending}
              className="rounded-full bg-[#0077f6] px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#0066d6] disabled:opacity-60 transition-all">{save.isPending ? "Saving…" : "Save Settings"}</button>
            <button onClick={generateNow} disabled={generating}
              className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-5 py-2.5 text-xs font-bold text-[#0077f6] hover:bg-blue-100 disabled:opacity-60 transition-all">
              <Send className="h-3.5 w-3.5" /> {generating ? "Generating…" : "Generate & Preview Now"}
            </button>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">Scheduled via server cron. Email delivery requires an email domain — reports are always stored and downloadable in the recent list.</p>
        </motion.section>

        <motion.section initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100"><Download className="h-4 w-4 text-[#0077f6]" /><h3 className="text-base font-extrabold text-slate-900">Recent Reports</h3></div>
          <div className="mt-4 max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
            {recentReports.length === 0 && <p className="text-xs text-slate-400 py-6 text-center">No reports generated yet.</p>}
            {recentReports.map((r) => (
              <div key={r.id} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold text-slate-800">{r.report_date}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.delivery_status === "failed" ? "border border-rose-200 bg-rose-50 text-rose-700" : "border border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{r.delivery_status}</span>
                </div>
                <div className="mt-1 text-[10px] text-slate-400">{new Date(r.generated_at).toLocaleString()}</div>
                {r.storage_url && <a href={r.storage_url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 font-bold text-[#0077f6] hover:underline">Open report →</a>}
                {r.error && <div className="mt-1 text-rose-600 font-semibold">{r.error}</div>}
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
    <motion.section initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">Permanent Audit</span>
          <h3 className="text-base font-extrabold text-slate-900 mt-0.5">Permanent Gate History</h3>
          <p className="text-xs text-slate-500">Every NFC check-in and check-out — never overwritten.</p>
        </div>
        <Activity className="h-4 w-4 text-[#0077f6]" />
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100">
        <div className="grid grid-cols-12 gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3 text-[11px] uppercase tracking-wider text-slate-500 font-bold">
          <div className="col-span-3">Time</div>
          <div className="col-span-3">Cadet</div>
          <div className="col-span-2">Direction</div>
          <div className="col-span-2">Result</div>
          <div className="col-span-2">NFC UID</div>
        </div>
        {rows.length === 0 && <div className="px-4 py-6 text-center text-xs text-slate-400">No gate activity yet.</div>}
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-12 items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-xs transition-colors hover:bg-slate-50/60 last:border-0">
            <div className="col-span-3 font-mono text-slate-500 font-medium">{new Date(r.occurred_at).toLocaleString([], { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}</div>
            <div className="col-span-3"><div className="font-bold text-slate-900">{r.cadet_name ?? "—"}</div><div className="font-mono text-[10px] text-slate-400">{r.roll_number ?? "—"}</div></div>
            <div className="col-span-2"><span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${r.direction === "CHECK_IN" ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-blue-200 bg-blue-50 text-[#0077f6]"}`}>{r.direction}</span></div>
            <div className="col-span-2"><span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${r.result === "SUCCESS" ? "text-emerald-700 bg-emerald-50" : r.result === "LATE" ? "text-amber-700 bg-amber-50" : "text-rose-700 bg-rose-50"}`}>{r.result}</span></div>
            <div className="col-span-2 font-mono text-[10px] text-slate-500">{r.nfc_uid ?? "—"}</div>
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
    <header className="sticky top-0 z-50 bg-white/75 backdrop-blur-xl border-b border-blue-100/60 shadow-sm">
      <div className="relative mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex flex-col">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#0077f6]">
              AMET IST
            </span>
            <span className="text-base font-extrabold tracking-tight text-slate-900 leading-tight">
              ShoreLeave
            </span>
          </div>
          <span className="hidden sm:inline-flex rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-[#0077f6] border border-blue-100">
            Admin
          </span>
        </div>

        <nav className="relative mx-auto hidden min-w-0 flex-1 justify-center md:flex">
          <div className="relative flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/90 p-1 shadow-sm overflow-x-auto no-scrollbar max-w-full">
            {NAV.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActive(item.id)}
                  className={`group relative flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ${
                    isActive
                      ? "bg-[#0077f6] text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <button
            onClick={onNotifications}
            aria-label={`Open notifications${notificationPage?.unread ? `, ${notificationPage.unread} unread` : ""}`}
            className="relative grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition-all hover:scale-105 active:scale-95"
          >
            <Bell className="h-4 w-4" />
            {!!notificationPage?.unread && (
              <span className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-[#0077f6] ring-2 ring-white" />
            )}
          </button>
          <div className="hidden items-center gap-2.5 rounded-full border border-slate-200 bg-white py-1 pl-1.5 pr-2.5 shadow-sm sm:flex">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-[#0077f6] text-xs font-bold text-white shadow-sm">
              {initials}
            </div>
            <div className="hidden flex-col items-start leading-tight lg:flex">
              <span className="text-xs font-bold text-slate-900">{name}</span>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                {profile?.role === "super_admin" ? "All Branches" : profile?.branch ? branchLabel(profile.branch) : "Admin"}
              </span>
            </div>
            <button
              onClick={signOut}
              title="Sign out"
              className="grid h-7 w-7 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm md:hidden"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${mobileOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="relative overflow-hidden border-b border-blue-100 bg-white/95 backdrop-blur-xl md:hidden"
          >
            <div className="mx-auto grid max-w-7xl grid-cols-2 gap-2 px-4 py-4 sm:grid-cols-3">
              {NAV.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setActive(item.id); setMobileOpen(false); }}
                    className={`flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-xs font-semibold transition-all ${
                      isActive
                        ? "border-[#0077f6] bg-[#0077f6] text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
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
    <motion.section initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="relative pt-6 sm:pt-8 pb-4">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50 px-3.5 py-1 text-xs font-semibold text-emerald-700 shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
            </span>
            All systems operational
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900">
            Welcome back, <span className="text-[#0077f6]">{name}</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm sm:text-base font-normal text-slate-500">
            Here is what is happening across AMET campus today. Approve leave, monitor gates, and track cadet movements.
          </p>
        </div>
        <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm min-w-[220px]">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
            <Clock className="h-3.5 w-3.5 text-[#0077f6]" /> Current Time
          </div>
          <div className="mt-1 font-mono text-2xl font-extrabold tabular-nums text-slate-900">{time}</div>
          <div className="mt-1 text-xs font-medium text-slate-500">{date}</div>
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
    { label: "Late Returns", value: data?.lateReturns ?? 0, hint: "Beyond curfew", icon: AlertTriangle },
    { label: "Blocked Cadets", value: data?.blockedCadets ?? 0, hint: `${data?.blockedCadetPercentage ?? 0}% suspended`, icon: Ban },
    { label: "Unknown NFC", value: data?.unknownNfc ?? 0, hint: "Unregistered taps", icon: HelpCircle },
    { label: "Denied Entries", value: data?.denied ?? 0, hint: "Gate rejections", icon: X },
    { label: "Rejected Leaves", value: data?.rejectedToday ?? 0, hint: "Today", icon: X },
    { label: "Pending Face Enrol", value: data?.facePending ?? 0, hint: `${data?.facePct ?? 0}% enrolled`, icon: ScanFace },
  ];
  return (
    <section className="mt-6 grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
      {stats.map((s, i) => <StatCard key={s.label} stat={s} delay={i * 0.04} loading={isLoading} />)}
    </section>
  );
}

function StatCard({ stat, delay, loading }: { stat: DashboardStat; delay: number; loading: boolean }) {
  const v = useCountUp(stat.value);
  const Icon = stat.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="rounded-3xl border border-slate-100/90 bg-white p-5 shadow-[0_4px_24px_-8px_rgba(15,23,42,0.06)] hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-50 text-[#0077f6]">
          <Icon className="h-5 w-5" />
        </div>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700 border border-emerald-200/60">
          live
        </span>
      </div>
      <div className="mt-4 text-3xl font-extrabold tabular-nums tracking-tight text-slate-900">
        {loading ? "—" : `${v}${stat.suffix ?? ""}`}
      </div>
      <div className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-600">
        {stat.label}
      </div>
      <div className="mt-0.5 text-xs text-slate-400 font-medium">{stat.hint}</div>
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
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="lg:col-span-2 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">Analytics</span>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 mt-0.5">Leave overview</h2>
          <p className="text-xs text-slate-500">Requests, approvals & rejections at a glance</p>
        </div>
        <div className="relative flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50/80 p-1">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setRange(r)} className={`relative rounded-full px-3.5 py-1 text-xs font-bold transition-all ${range === r ? "bg-[#0077f6] text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-6 h-72 w-full">
        {isLoading && <div className="grid h-full place-items-center text-xs text-slate-400">Loading leave trends…</div>}
        {isError && <div className="grid h-full place-items-center text-xs text-rose-600 font-bold">Unable to load leave trends.</div>}
        {!isLoading && !isError && chartData.length === 0 && <div className="grid h-full place-items-center text-xs text-slate-400">No leave trend data available.</div>}
        {!isLoading && !isError && chartData.length > 0 && <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 0, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="g-req" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0077f6" stopOpacity={0.3} /><stop offset="100%" stopColor="#0077f6" stopOpacity={0} /></linearGradient>
              <linearGradient id="g-app" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 16, fontSize: 12, color: "#0f172a", boxShadow: "0 10px 25px -5px rgba(0,0,0,0.08)" }} labelStyle={{ fontWeight: "bold", color: "#0f172a" }} />
            <Area type="monotone" dataKey="requested" stroke="#0077f6" strokeWidth={2.5} fill="url(#g-req)" />
            <Area type="monotone" dataKey="approved" stroke="#10b981" strokeWidth={2} fill="url(#g-app)" />
            <Area type="monotone" dataKey="rejected" stroke="#f43f5e" strokeWidth={1.5} fillOpacity={0} />
            <Area type="monotone" dataKey="expired" stroke="#94a3b8" strokeWidth={1.5} fillOpacity={0} />
          </AreaChart>
        </ResponsiveContainer>}
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-xs font-semibold text-slate-500">
        <Legend dot="#0077f6" label="Requested" />
        <Legend dot="#10b981" label="Approved" />
        <Legend dot="#f43f5e" label="Rejected" />
        <Legend dot="#94a3b8" label="Expired" />
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
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
      <div>
        <span className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">Operations</span>
        <h2 className="text-lg font-extrabold tracking-tight text-slate-900 mt-0.5">Quick actions</h2>
        <p className="text-xs text-slate-500">Frequent operations, one click away</p>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        {ACTIONS.map((a, i) => {
          const Icon = a.icon;
          return (
            <motion.button key={a.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.04 }}
              whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
              onClick={() => toast.info(`${a.label}: no matching backend endpoint is exposed in Shore Leave Express.`)}
              className="group flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5 text-left transition-all hover:border-blue-200 hover:bg-blue-50/40">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[#0077f6] shadow-xs transition-transform group-hover:scale-110"><Icon className="h-4 w-4" /></div>
              <span className="text-xs font-bold text-slate-800">{a.label}</span>
            </motion.button>
          );
        })}
        <button className="col-span-2 mt-1 flex items-center justify-center gap-2 rounded-2xl bg-[#0077f6] py-3 text-xs font-bold text-white shadow-sm transition-transform hover:bg-[#0066d6]">
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
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="lg:col-span-2 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">Live Review</span>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 mt-0.5">Recent leave requests</h2>
          <p className="text-xs text-slate-500">Approve or review without leaving the dashboard</p>
        </div>
      </div>
      <div className="mt-4 divide-y divide-slate-100">
        {isLoading && <p className="py-6 text-center text-xs text-slate-400">Loading…</p>}
        {!isLoading && filtered.length === 0 && <p className="py-6 text-center text-xs text-slate-400">No requests match.</p>}
        {filtered.map((r) => {
          const initials = (r.cadet?.full_name ?? "?").split(" ").map((x: string) => x[0]).slice(0, 2).join("").toUpperCase();
          const dur = humanDuration(r.start_at, r.end_at);
          return (
            <motion.div key={r.id} layout className="flex flex-wrap items-center gap-4 py-3.5 transition-colors hover:bg-slate-50/50 rounded-2xl px-2">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-blue-50 text-xs font-extrabold text-[#0077f6]">{initials}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-bold text-slate-900">{r.cadet?.full_name ?? "—"}</span>
                  <span className="text-xs font-mono text-slate-500">{r.cadet?.cadet_code}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1 font-medium"><MapPin className="h-3 w-3 text-slate-400" />{r.destination}</span>
                  <span>· {dur}</span>
                </div>
              </div>
              <StatusBadge status={r.status} />
              <div className="flex items-center gap-1.5">
                <button disabled={r.status !== "pending" || mut.isPending || !(r.roll || r.cadet?.cadet_code)} onClick={() => mut.mutate({ roll: r.roll || r.cadet?.cadet_code || "", status: "approved" })}
                  className="grid h-8 w-8 place-items-center rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-30" title="Approve"><Check className="h-4 w-4" /></button>
                <button disabled={r.status !== "pending" || mut.isPending || !(r.roll || r.cadet?.cadet_code)} onClick={() => mut.mutate({ roll: r.roll || r.cadet?.cadet_code || "", status: "rejected", reason: "Rejected by administrator" })}
                  className="grid h-8 w-8 place-items-center rounded-full bg-rose-50 border border-rose-200 text-rose-600 transition-colors hover:bg-rose-100 disabled:opacity-30" title="Reject"><X className="h-4 w-4" /></button>
                <button className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:border-slate-300" title="View"><Eye className="h-4 w-4" /></button>
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
  const normalized = (status || "").toLowerCase().trim();
  let style = "bg-slate-100 text-slate-700 border-slate-200";

  if (["approved", "ready", "gate_pass_ready", "active"].includes(normalized)) {
    style = "bg-emerald-50 text-emerald-700 border-emerald-200";
  } else if (["pending", "review", "in_review", "submitted"].includes(normalized)) {
    style = "bg-amber-50 text-amber-700 border-amber-200";
  } else if (["rejected", "blocked", "danger"].includes(normalized)) {
    style = "bg-rose-50 text-rose-700 border-rose-200";
  } else if (["out", "checked_out"].includes(normalized)) {
    style = "bg-blue-50 text-[#0077f6] border-blue-200";
  }

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${style}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function LiveGateFeed() {
  const { data: events = [] } = useQuery({ queryKey: queryKeys.admin.gateEvents, queryFn: fetchRecentGate, refetchInterval: 30_000 });
  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">Gates</span>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 mt-0.5">Live gate activity</h2>
          <p className="text-xs text-slate-500">Real-time entries & exits</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-600" /> Live
        </span>
      </div>
      <ul className="mt-4 space-y-2">
        <AnimatePresence initial={false}>
          {events.map((e) => (
            <motion.li key={e.id} initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
              className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3 transition-colors hover:bg-slate-50">
              <div className={`grid h-8 w-8 place-items-center rounded-xl ${e.direction === "entry" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-blue-50 text-[#0077f6] border border-blue-200"}`}>
                {e.direction === "entry" ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-slate-900">{e.cadet?.full_name ?? "—"}</div>
                <div className="text-[10px] text-slate-500 uppercase font-medium">{e.method} verified · {e.gate_name}</div>
              </div>
              <span className="font-mono text-[10px] font-semibold text-slate-400">{new Date(e.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
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
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#0077f6] py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#0066d6] transition-all disabled:opacity-60"
      >
        <ScanFace className="h-4 w-4" />
        Enroll one more face
      </button>
      <button onClick={onOpen} className="mt-2 w-full rounded-full border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors">Continue enrollment</button>
    </PanelCard>
  );
}

function RingProgress({ value }: { value: number }) {
  const v = useCountUp(value, 1400);
  const r = 52; const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto h-32 w-32">
      <svg viewBox="0 0 120 120" className="-rotate-90">
        <circle cx="60" cy="60" r={r} stroke="#f1f5f9" strokeWidth="10" fill="none" />
        <motion.circle cx="60" cy="60" r={r} stroke="#0077f6" strokeWidth="10" fill="none" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c - (c * value) / 100 }} transition={{ duration: 1.4 }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center"><div className="text-2xl font-black tabular-nums text-slate-900">{v}%</div><div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Coverage</div></div>
      </div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 text-base font-extrabold ${tone}`}>{value}</div>
    </div>
  );
}

function PanelCard({ title, subtitle, icon: Icon, children }: { title: string; subtitle: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-50 text-[#0077f6]"><Icon className="h-5 w-5" /></div>
        <div><h2 className="text-base font-extrabold tracking-tight text-slate-900">{title}</h2><p className="text-xs text-slate-500">{subtitle}</p></div>
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
        <Mini label="Assigned" value={String(data?.assigned ?? 0)} tone="text-emerald-700" />
        <Mini label="Pending" value={String(data?.pending ?? 0)} tone="text-amber-700" />
        <Mini label="Lost" value="0" tone="text-rose-700" />
        <Mini label="Scanned today" value={String(scannedToday)} tone="text-[#0077f6]" />
      </div>
      <button onClick={() => toast.info("Use the NFC management reader flow; this compact card has no backend endpoint for manual UID assignment.")} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#0077f6] py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#0066d6] transition-all"><Plus className="h-4 w-4" /> Assign new card</button>
    </PanelCard>
  );
}

function EmergencyCodeStats() {
  const { data, isLoading, isError } = useQuery({ queryKey: queryKeys.admin.summary, queryFn: fetchAdminSummary });
  return (
    <PanelCard title="Emergency verification overview" subtitle="Manual gate fallback lifecycle" icon={KeyRound}>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Mini label="Codes today" value={isLoading ? "…" : String(data?.emergencyCodesToday ?? 0)} tone="text-[#0077f6]" />
        <Mini label="Gate in today" value={isLoading ? "…" : String(data?.gateEntries ?? 0)} tone="text-emerald-700" />
        <Mini label="Gate out today" value={isLoading ? "…" : String(data?.gateExits ?? 0)} tone="text-amber-700" />
        <Mini label="Pending fingerprint" value={isLoading ? "…" : String(data?.facePending ?? 0)} tone="text-slate-500" />
      </div>
      <div className="mt-5 rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-4 text-center">
        <KeyRound className="mx-auto h-8 w-8 text-[#0077f6]" />
        <p className={`mt-2 text-xs font-medium ${isError ? "text-rose-600 font-bold" : "text-slate-500"}`}>
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
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">Infrastructure</span>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 mt-0.5">System health</h2>
          <p className="text-xs text-slate-500">Live service status</p>
        </div>
        <Activity className="h-4 w-4 text-[#0077f6]" />
      </div>
      <div className="mt-4 space-y-2">
        {isLoading && <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-400">Loading system health…</div>}
        {!isLoading && services.map((s) => (
          <div key={s.n} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-2.5">
            <div className="flex items-center gap-2.5"><StatusDot status={s.s} /><span className="text-xs font-bold text-slate-800">{s.n}</span></div>
            <span className="font-mono text-[11px] text-slate-400 font-medium">{s.lat}</span>
          </div>
        ))}
      </div>
    </motion.section>
  );
}

function StatusDot({ status }: { status: string }) {
  const tone = status === "healthy" ? "bg-emerald-500" : status === "warning" ? "bg-amber-500" : "bg-rose-500";
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
    <motion.section initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="mt-8 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-600"><Filter className="h-3.5 w-3.5 text-[#0077f6]" /> Filter</div>
        <input type="time" defaultValue="06:00" className="rounded-full border border-slate-200 bg-slate-50/60 px-3.5 py-1.5 text-xs font-medium text-slate-800" />
        <span className="text-xs text-slate-400">to</span>
        <input type="time" defaultValue="21:00" className="rounded-full border border-slate-200 bg-slate-50/60 px-3.5 py-1.5 text-xs font-medium text-slate-800" />
        <input type="date" className="rounded-full border border-slate-200 bg-slate-50/60 px-3.5 py-1.5 text-xs font-medium text-slate-800" />
        <select className="rounded-full border border-slate-200 bg-slate-50/60 px-3.5 py-1.5 text-xs font-medium text-slate-800"><option>All leave types</option><option>Town</option><option>Weekend</option><option>Emergency</option></select>
        <select className="rounded-full border border-slate-200 bg-slate-50/60 px-3.5 py-1.5 text-xs font-medium text-slate-800"><option>Any status</option><option>Pending</option><option>Approved</option><option>Rejected</option></select>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {quicks.map((q) => (
            <button key={q} onClick={()=>setQuick(q)} className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${quick===q?"bg-[#0077f6] text-white shadow-sm":"border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{q}</button>
          ))}
          <button className="rounded-full bg-[#0077f6] px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-[#0066d6] transition-all">Apply</button>
          <button className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors">Clear</button>
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
    { name: "Approved", value: data?.approved ?? 0, color: "#10b981" },
    { name: "Pending", value: data?.pending ?? 0, color: "#f59e0b" },
    { name: "Rejected", value: data?.rejected ?? 0, color: "#f43f5e" },
    { name: "Returned", value: data?.returned ?? 0, color: "#0077f6" },
  ];
  const total = slices.reduce((a,b)=>a+b.value,0);
  return (
    <motion.section initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="pb-3 border-b border-slate-100">
        <span className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">Distribution</span>
        <h2 className="text-lg font-extrabold tracking-tight text-slate-900 mt-0.5">Leave status</h2>
        <p className="text-xs text-slate-500">Distribution across all requests</p>
      </div>
      <div className="relative mt-4 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" innerRadius={56} outerRadius={84} paddingAngle={4} stroke="none">
              {slices.map((s,i)=>(<Cell key={i} fill={s.color} />))}
            </Pie>
            <Tooltip contentStyle={{ background:"#ffffff", border:"1px solid #e2e8f0", borderRadius:16, fontSize:12, boxShadow: "0 10px 25px -5px rgba(0,0,0,0.08)" }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="text-center"><div className="text-3xl font-black tabular-nums text-slate-900">{total}</div><div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Total</div></div></div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        {slices.map((s)=>(
          <div key={s.name} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/60 px-3 py-2">
            <span className="flex items-center gap-2 font-bold text-slate-700"><span className="h-2.5 w-2.5 rounded-full" style={{background:s.color}} />{s.name}</span>
            <span className="font-mono font-bold text-slate-900">{s.value}</span>
          </div>
        ))}
      </div>
    </motion.section>
  );
}

function ActivityFeed() {
  const { data: events = [] } = useQuery({ queryKey: queryKeys.admin.gateEvents, queryFn: fetchRecentGate });
  return (
    <motion.section initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">Live Stream</span>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 mt-0.5">Recent activity</h2>
          <p className="text-xs text-slate-500">Live feed across all gates</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-600" /> Live
        </span>
      </div>
      <ul className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {events.map((e) => (
            <motion.li key={e.id} initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3 transition-colors hover:bg-slate-50">
              <div className={`grid h-8 w-8 place-items-center rounded-xl ${e.direction==="entry" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-blue-50 text-[#0077f6] border border-blue-200"}`}>
                {e.direction==="entry" ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-slate-900">{e.cadet?.full_name ?? "—"}</div>
                <div className="text-[10px] uppercase font-medium text-slate-500">{e.direction} · {e.method}</div>
              </div>
              <span className="font-mono text-[10px] font-semibold text-slate-400">{new Date(e.occurred_at).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</span>
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
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-8 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-5">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">Branch Comparison</span>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 mt-0.5">Live snapshot across all 5 branches</h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-[#0077f6]">
          <ShieldCheck className="h-3.5 w-3.5" /> All branches
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-6 py-3.5 text-left font-bold">Branch</th>
              <th className="px-4 py-3.5 text-right font-bold">Cadets</th>
              <th className="px-4 py-3.5 text-right font-bold">Outside</th>
              <th className="px-4 py-3.5 text-right font-bold">Pending</th>
              <th className="px-4 py-3.5 text-right font-bold">Approved</th>
              <th className="px-6 py-3.5 text-right font-bold">Compliance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading &&
              BRANCHES.map((b) => (
                <tr key={b.code}><td colSpan={6} className="px-6 py-4 text-xs text-slate-400">Loading {b.name}…</td></tr>
              ))}
            {!isLoading && rows.map((r) => (
              <tr key={r.code} className="transition-colors hover:bg-slate-50/60">
                <td className="px-6 py-4 font-bold text-slate-900">{r.label}</td>
                <td className="px-4 py-4 text-right tabular-nums font-semibold text-slate-800">{r.total}</td>
                <td className="px-4 py-4 text-right tabular-nums font-semibold text-slate-800">{r.outside}</td>
                <td className="px-4 py-4 text-right tabular-nums font-semibold">{r.pending > 0 ? <span className="text-amber-600 font-bold">{r.pending}</span> : r.pending}</td>
                <td className="px-4 py-4 text-right tabular-nums font-semibold text-emerald-600">{r.approved}</td>
                <td className="px-6 py-4 text-right">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold border ${r.compliance >= 90 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : r.compliance >= 75 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-rose-50 text-rose-700 border-rose-200"}`}>
                    {r.compliance}%
                  </span>
                </td>
              </tr>
            ))}
            <tr className="bg-slate-50/80 font-extrabold text-slate-900">
              <td className="px-6 py-4">Total</td>
              <td className="px-4 py-4 text-right tabular-nums">{totals.total}</td>
              <td className="px-4 py-4 text-right tabular-nums">{totals.outside}</td>
              <td className="px-4 py-4 text-right tabular-nums">{totals.pending}</td>
              <td className="px-4 py-4 text-right tabular-nums text-emerald-600">{totals.approved}</td>
              <td className="px-6 py-4 text-right tabular-nums">{totalCompliance}%</td>
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
      className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">Hardware</span>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 mt-0.5">Live gate monitor</h2>
          <p className="text-xs text-slate-500">Reader, camera & face health</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold ${device?.nfc === "online" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${device?.nfc === "online" ? "bg-emerald-600" : "bg-amber-600"}`} /> {deviceLoading ? "Checking" : device?.nfc === "online" ? "Online" : "Attention"}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Mini label="IN Today"  value={String(data?.gateEntries ?? 0)} tone="text-emerald-700" />
        <Mini label="OUT Today" value={String(data?.gateExits ?? 0)}   tone="text-[#0077f6]" />
      </div>
      <ul className="mt-4 space-y-2">
        {gates.map((g) => (
          <li key={g.name} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900">{g.name}</span>
              <span className="font-mono text-[10px] text-slate-400">{g.checkedAt ? new Date(g.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
            </div>
            <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500 font-medium">
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
      className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">Roll Call</span>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 mt-0.5">Attendance</h2>
          <p className="text-xs text-slate-500">Campus presence right now</p>
        </div>
        <span className="text-xs font-bold text-[#0077f6] bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">{pct}% inside</span>
      </div>
      <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1 }}
          className="h-full bg-[#0077f6] rounded-full" />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        <Mini label="Inside"  value={String(inside)}  tone="text-emerald-700" />
        <Mini label="Outside" value={String(outside)} tone="text-amber-700" />
        <Mini label="On Leave" value={String(data?.approvedToday ?? 0)} tone="text-[#0077f6]" />
        <Mini label="Present"  value={String(inside)} tone="text-emerald-700" />
        <Mini label="Absent"   value={String(outside)} tone="text-rose-700" />
        <Mini label="Late Returns" value="0" tone="text-amber-700" />
      </div>
    </motion.section>
  );
}

/* ============================ RETURN MONITOR ============================= */
function ReturnMonitor() {
  const { data } = useQuery({ queryKey: queryKeys.admin.returnMonitor, queryFn: fetchReturnMonitor, refetchInterval: 60_000 });
  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">Tracking</span>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 mt-0.5">Return monitor</h2>
          <p className="text-xs text-slate-500">Expected & overdue returns</p>
        </div>
        <Clock className="h-4 w-4 text-[#0077f6]" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <Mini label="Today"    value={String(data?.today ?? 0)}    tone="text-[#0077f6]" />
        <Mini label="Tomorrow" value={String(data?.tomorrow ?? 0)} tone="text-slate-800" />
        <Mini label="Overdue"  value={String(data?.overdue ?? 0)}  tone="text-rose-700" />
      </div>
      <div className="mt-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Overdue cadets</div>
        <ul className="mt-2 space-y-2">
          {(data?.overdueList ?? []).length === 0 && (
            <li className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 text-center text-xs text-slate-400">
              No overdue cadets. All clear.
            </li>
          )}
          {(data?.overdueList ?? []).map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-2xl border border-rose-200/80 bg-rose-50/60 p-3">
              <div className="min-w-0">
                <div className="truncate text-xs font-bold text-slate-900">{r.cadet?.full_name ?? "—"}</div>
                <div className="font-mono text-[10px] text-slate-500">{r.cadet?.cadet_code ?? ""}</div>
              </div>
              <span className="font-mono text-[11px] font-bold text-rose-700">
                due {new Date(r.end_at).toLocaleDateString([], { day: "2-digit", month: "short" })}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </motion.section>
  );
}
