import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ApiError, apiRequest } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import { queryKeys } from "@/api/query-keys";
import { TokenService } from "@/services/token.service";
import { cadetVerifyFace, deleteCurrentAccount, getCurrentUser, logoutSession } from "@/api/auth";
import { useAuth } from "@/contexts/AuthContext";
import { getErrorMessage } from "@/lib/errors";
import { getCameraRuntimeIssue, logCameraRuntime, requestUserCamera } from "@/lib/camera-runtime";
import type { Cadet, LeaveRequest, MutationResult, NotificationPage } from "@/types";
import { toast } from "sonner";
import {
  Sparkles, LogOut, Calendar, KeyRound, ScanFace, Plus, Loader2,
  Home, Trophy, User, Bell, Anchor, Camera, MapPin,
  ArrowRight, Check, X, Coins, Gift, Flame, Star, ChevronRight,
  Crown, Medal, TrendingUp, Clock, Lock, Pencil, QrCode, FileText,
  CheckCircle2, AlertCircle, PartyPopper, Package, ArrowUpRight,
  ShieldCheck, Download, Mail, ExternalLink, RefreshCw
} from "lucide-react";
import {
  ShoreCard,
  ShoreButton,
  ShoreStatCard,
  ShoreStatusBadge,
  ShoreFilterPill,
  ShoreInput,
  ShorePageHeader,
  ShoreNotificationBell,
  ShoreEmptyState,
  ShoreModal,
} from "@/components/shoreleave";
import panel1 from "@/assets/amet-panel1.jpg.asset.json";
import panel2 from "@/assets/amet-panel2.jpg.asset.json";
import panel3 from "@/assets/amet-panel3.jpg.asset.json";

export const Route = createFileRoute("/_authenticated/cadet")({
  beforeLoad: async ({ context }) => {
    if (TokenService.getCadetFaceToken()) {
      return;
    }
    let user: Awaited<ReturnType<typeof getCurrentUser>>;
    try {
      user = await context.queryClient.ensureQueryData({
        queryKey: queryKeys.auth.me,
        queryFn: getCurrentUser,
        staleTime: 60_000,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw redirect({ to: "/auth", search: { role: "cadet" } });
      return;
    }
    const roles = user.roles?.map((entry) => entry.role) ?? (user.role ? [user.role] : []);
    if (roles.some((role) => ["admin", "super_admin", "hod", "officer"].includes(role))) {
      throw redirect({ to: "/admin" });
    }
  },
  head: () => ({ meta: [{ title: "Cadet · Shore Leave" }] }),
  component: CadetDashboard,
});

export type TabKey = "home" | "leaves" | "apply" | "pass" | "profile" | "rewards" | "ranks";
type OnboardStep = "welcome" | "permissions" | "otp" | "attention" | "done";

type CadetDashboardResponse = {
  cadet: {
    name?: string;
    roll?: string;
    studentId?: string;
    batch?: string;
    course?: string;
    department?: string;
    email?: string;
    phone?: string;
    photoUrl?: string;
    leaveBlocked?: boolean;
    leaveBlockedReason?: string;
    leaveBlockedDate?: string | null;
    leaveBlockedUntil?: string | null;
    face_enrolled?: boolean;
    faceEnrollmentData?: { enrolled?: boolean; enrolledAt?: string | null };
  };
  leave: { status?: string; statusText?: string; request?: DashboardLeaveRow | null };
  leaveBlock?: { blocked?: boolean; reason?: string; blockedAt?: string | null; blockedUntil?: string | null };
  history?: DashboardLeaveRow[];
  shoreLeaveHistory?: DashboardLeaveRow[];
  gamification?: {
    leaveTokens?: number;
    maxLeaveTokens?: number;
    leaveTokenBalance?: LeaveTokenBalance;
  };
};

export type LeaveTokenBalance = {
  month?: number;
  year?: number;
  monthLabel?: string;
  monthlyAllocation?: number;
  allocation?: number;
  used?: number;
  consumed?: number;
  reserved?: number;
  available?: number;
  expired?: number;
  transactions?: Array<{
    id?: string;
    type?: string;
    amount?: number;
    reason?: string;
    timestamp?: string;
  }>;
};

type DashboardLeaveRow = {
  _id?: string;
  requestId?: string;
  dest?: string;
  destination?: string;
  reason?: string;
  leaveReason?: string;
  fromDate?: string;
  toDate?: string;
  status?: string;
  approvalStatus?: string;
  qrUrl?: string | null;
  pdfUrl?: string | null;
  gatePassUrl?: string | null;
  gatePassPdfUrl?: string | null;
  gatePassPdf?: string | null;
  gatePass?: {
    url?: string | null;
    publicUrl?: string | null;
    pdfUrl?: string | null;
    pdfPublicUrl?: string | null;
    qrUrl?: string | null;
  } | null;
  storage?: {
    pdfUrl?: string | null;
    qrUrl?: string | null;
  } | null;
};

type LeaveRequestWithAssets = LeaveRequest & {
  qrUrl?: string | null;
  pdfUrl?: string | null;
  gatePassUrl?: string | null;
  gatePassPdfUrl?: string | null;
  gatePassPdf?: string | null;
  gatePass?: DashboardLeaveRow["gatePass"];
  storage?: DashboardLeaveRow["storage"];
};

function extractGatePassAssetFields(row?: DashboardLeaveRow | null): Partial<LeaveRequestWithAssets> {
  if (!row) return {};
  return {
    qrUrl: row.qrUrl ?? row.gatePass?.qrUrl ?? row.storage?.qrUrl ?? null,
    pdfUrl: row.pdfUrl ?? row.gatePass?.pdfUrl ?? row.gatePass?.pdfPublicUrl ?? row.storage?.pdfUrl ?? null,
    gatePassUrl: row.gatePassUrl ?? row.gatePass?.url ?? row.gatePass?.publicUrl ?? null,
    gatePassPdfUrl: row.gatePassPdfUrl ?? row.gatePass?.pdfUrl ?? row.gatePass?.pdfPublicUrl ?? null,
    gatePassPdf: row.gatePassPdf ?? null,
    gatePass: row.gatePass ?? null,
    storage: row.storage ?? null,
  };
}

function getGatePassDownloadUrl(leave?: LeaveRequest): string | null {
  const asset = leave as LeaveRequestWithAssets | undefined;
  return asset?.gatePassPdfUrl
    ?? asset?.pdfUrl
    ?? asset?.gatePassPdf
    ?? asset?.gatePassUrl
    ?? asset?.gatePass?.pdfUrl
    ?? asset?.gatePass?.pdfPublicUrl
    ?? asset?.gatePass?.publicUrl
    ?? asset?.gatePass?.url
    ?? asset?.storage?.pdfUrl
    ?? null;
}

function normalizeCadetDashboardProfile(data: CadetDashboardResponse): Cadet {
  const leaveBlock = data.leaveBlock ?? {};
  const leaveBlocked = Boolean(leaveBlock.blocked ?? data.cadet.leaveBlocked);
  const faceEnrolled = Boolean(data.cadet.face_enrolled ?? data.cadet.faceEnrollmentData?.enrolled);
  return {
    id: data.cadet.roll || "",
    roll: data.cadet.roll,
    cadet_code: data.cadet.roll || data.cadet.studentId || "",
    full_name: data.cadet.name || data.cadet.roll || "Cadet",
    name: data.cadet.name,
    email: data.cadet.email,
    phone: data.cadet.phone,
    branch: data.cadet.course || data.cadet.batch,
    department: data.cadet.department || data.cadet.course || data.cadet.batch,
    photo_url: data.cadet.photoUrl || null,
    current_leave_id: data.leave.request?.requestId || null,
    leave_blocked: leaveBlocked,
    leave_blocked_reason: leaveBlock.reason ?? data.cadet.leaveBlockedReason ?? null,
    leave_blocked_date: leaveBlock.blockedAt ?? data.cadet.leaveBlockedDate ?? null,
    leave_blocked_until: leaveBlock.blockedUntil ?? data.cadet.leaveBlockedUntil ?? null,
    face_enrolled: faceEnrolled,
    leave_tokens: data.gamification?.leaveTokens ?? 4,
    max_leave_tokens: data.gamification?.maxLeaveTokens ?? 8,
    leave_token_balance: data.gamification?.leaveTokenBalance,
  };
}

function normalizeCadetDashboardRequests(data: CadetDashboardResponse): LeaveRequest[] {
  const active = data.leave.request ? [{
    id: data.leave.request.requestId || "active",
    roll: data.cadet.roll,
    destination: data.leave.request.dest || data.leave.request.destination || "—",
    reason: data.leave.request.reason || null,
    start_at: data.leave.request.fromDate || new Date().toISOString(),
    end_at: data.leave.request.toDate || new Date().toISOString(),
    status: data.leave.request.approvalStatus === "approved" ? "approved" : data.leave.request.approvalStatus === "rejected" ? "rejected" : "pending",
    ...extractGatePassAssetFields(data.leave.request),
  } as LeaveRequest] : [];
  const history = [...(data.history ?? []), ...(data.shoreLeaveHistory ?? [])].map((row) => ({
    id: row._id || `${row.dest}-${row.fromDate}`,
    roll: data.cadet.roll,
    destination: row.dest || row.destination || "—",
    reason: row.leaveReason || null,
    start_at: row.fromDate || new Date().toISOString(),
    end_at: row.toDate || new Date().toISOString(),
    status: row.approvalStatus === "approved" || row.status === "out" ? "approved" : row.approvalStatus === "rejected" ? "rejected" : row.status === "returned" ? "returned" : "pending",
    ...extractGatePassAssetFields(row),
  } as LeaveRequest));
  return [...active, ...history];
}

function getGreeting(name: string): string {
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return `${timeGreeting}, ${name}`;
}

function CadetDashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { login } = useAuth();
  const { data: notificationPage } = useQuery({
    queryKey: queryKeys.cadet.notifications,
    queryFn: () => apiRequest<NotificationPage>(endpoints.notifications.list("?limit=50")),
    refetchInterval: 60_000,
  });
  const [pendingFace, setPendingFace] = useState(() => {
    const token = TokenService.getToken();
    return !!TokenService.getCadetFaceToken() || TokenService.getRole(token ?? "") === "cadet_pending_face";
  });
  const [userId, setUserId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("Cadet");
  const [tab, setTab] = useState<TabKey>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [gateEmailBusy, setGateEmailBusy] = useState(false);
  const [onboard, setOnboard] = useState<OnboardStep>(() => {
    if (typeof window === "undefined") return "done";
    return (sessionStorage.getItem("cadet_onboard") as OnboardStep) || "welcome";
  });

  useEffect(() => {
    if (typeof window !== "undefined") sessionStorage.setItem("cadet_onboard", onboard);
  }, [onboard]);

  useEffect(() => {
    if (pendingFace) return;
    qc.ensureQueryData({ queryKey: queryKeys.auth.me, queryFn: getCurrentUser, staleTime: 60_000 }).then((user) => {
      setUserId(user.id || user._id || null);
      setProfileName(user.fullName || user.full_name || user.email?.split("@")[0] || "Cadet");
    }).catch(() => undefined);
  }, [pendingFace, qc]);

  const completeFaceLogin = (token: string) => {
    login(token);
    TokenService.removeCadetFaceToken();
    setPendingFace(false);
    setOnboard("done");
    if (typeof window !== "undefined") sessionStorage.setItem("cadet_onboard", "done");
    qc.ensureQueryData({ queryKey: queryKeys.auth.me, queryFn: getCurrentUser, staleTime: 60_000 }).then((user) => {
      setUserId(user.id || user._id || null);
      setProfileName(user.fullName || user.full_name || user.email?.split("@")[0] || "Cadet");
    }).catch(() => undefined);
    qc.invalidateQueries({ queryKey: queryKeys.auth.me });
    qc.invalidateQueries({ queryKey: queryKeys.cadet.notifications });
  };

  const { data: cadet, isLoading: cadetLoading } = useQuery({
    queryKey: queryKeys.cadet.profile(userId ?? undefined),
    enabled: !pendingFace && !!userId,
    queryFn: async () => {
      return normalizeCadetDashboardProfile(await apiRequest<CadetDashboardResponse>(endpoints.cadet.dashboard));
    },
    refetchInterval: 10_000,
  });

  const { data: requests = [], isLoading: requestsLoading } = useQuery({
    queryKey: queryKeys.cadet.leaveRequests(cadet?.id),
    enabled: !pendingFace && !!cadet?.id,
    queryFn: async () => {
      return normalizeCadetDashboardRequests(await apiRequest<CadetDashboardResponse>(endpoints.cadet.dashboard));
    },
  });

  async function signOut() {
    try { await logoutSession(); } catch { /* Clear this device even if the server is unavailable. */ }
    await qc.cancelQueries(); qc.clear();
    TokenService.clearAll();
    navigate({ to: "/auth", search: { role: "cadet" }, replace: true });
  }

  if (pendingFace) {
    return <FaceLoginVerification onVerified={completeFaceLogin} onCancel={signOut} />;
  }

  if (onboard !== "done") {
    return <Onboarding step={onboard} setStep={setOnboard} name={profileName} />;
  }

  if (userId && cadetLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f0f7ff]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-[#0077f6]" aria-label="Loading cadet profile" />
          <p className="text-sm font-semibold text-slate-500">Loading ShoreLeave portal…</p>
        </div>
      </div>
    );
  }

  const rollNo = cadet?.cadet_code ?? "NDA-0000";
  const department = cadet?.branch ?? "Executive";
  const leaveBlocked = !!cadet?.leave_blocked;

  const openLeave = () => {
    if (leaveBlocked) {
      toast.error("Your leave privileges are currently suspended.");
      setTab("leaves");
      return;
    }
    setDrawerOpen(true);
  };

  const latestApprovedLeave = requests.find((request) => request.status === "approved");

  const openGatePass = () => {
    if (leaveBlocked) {
      toast.error("Your leave privileges are currently suspended.");
      setTab("leaves");
      return;
    }
    if (!latestApprovedLeave) {
      toast.info("No approved gate pass is ready yet. Check your leave status first.");
      setTab("leaves");
      return;
    }
    setTab("pass");
  };

  const openFaceEnrollment = () => {
    if (cadet?.face_enrolled) {
      toast.success("Face enrollment is already active.");
      setTab("profile");
      return;
    }
    toast.info("Face enrollment is completed by the Duty Officer or Admin enrollment console.");
    setTab("profile");
  };

  const editProfile = () => {
    toast.info("Profile changes are managed by administration. Please contact the duty officer.");
  };

  const deleteAccount = async () => {
    const confirmation = window.prompt(`This permanently deletes your account data. Enter ${rollNo} to confirm.`);
    if (confirmation === null) return;
    if (confirmation.trim().toUpperCase() !== rollNo.trim().toUpperCase()) {
      toast.error("Roll number did not match. No data was deleted.");
      return;
    }
    try {
      await deleteCurrentAccount(confirmation);
      toast.success("Your account data was deleted.");
      await qc.cancelQueries(); qc.clear();
      TokenService.clearAll();
      navigate({ to: "/auth", search: { role: "cadet" }, replace: true });
    } catch (error) {
      toast.error(getErrorMessage(error, "Account deletion could not be completed."));
    }
  };

  const sendGatePassEmail = async (leave?: LeaveRequest) => {
    if (!leave) {
      toast.info("No approved gate pass is available to email yet.");
      setTab("leaves");
      return;
    }
    if (gateEmailBusy) return;
    setGateEmailBusy(true);
    try {
      await apiRequest<MutationResult>(endpoints.cadet.sendGatePassEmail, {
        method: "POST",
        body: JSON.stringify({ requestId: leave.id, leaveId: leave.id }),
      });
      toast.success("Gate pass email request sent.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Gate pass email is not available yet."));
    } finally {
      setGateEmailBusy(false);
    }
  };

  const downloadGatePass = (leave?: LeaveRequest) => {
    const url = getGatePassDownloadUrl(leave);
    if (!url) {
      toast.info("Gate pass PDF is issued after gate check-out verification.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="relative min-h-screen text-slate-900 antialiased selection:bg-blue-100 selection:text-blue-900">
      {/* Top Header / Navigation (Consistent with APK) */}
      <CadetTopHeader
        name={profileName}
        rollNo={rollNo}
        tab={tab}
        setTab={setTab}
        unread={notificationPage?.unread ?? 0}
        onBell={() => setNotifOpen(true)}
        onSignOut={signOut}
      />

      {/* Main Content Area */}
      <main className="mx-auto w-full max-w-4xl px-4 pb-28 pt-4 sm:px-6 sm:pb-24 lg:max-w-5xl">
        {!cadet && (
          <div className="mb-6 rounded-3xl border border-amber-200 bg-amber-50/80 p-4 text-sm font-medium text-amber-800">
            Your account isn't linked to a cadet record yet. Ask an administrator to assign your cadet profile.
          </div>
        )}

        {cadet?.leave_blocked && <LeaveBlockedBanner cadet={cadet} />}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            {tab === "home" && (
              requestsLoading ? (
                <div className="py-20 text-center text-sm text-slate-500 font-medium">Loading leave requests…</div>
              ) : (
                <HomeView
                  name={profileName}
                  requests={requests}
                  cadet={cadet}
                  onApply={() => setTab("apply")}
                  onOpenLeave={openLeave}
                  onOpenGatePass={openGatePass}
                  onViewLeaves={() => setTab("leaves")}
                  onSendGatePassEmail={sendGatePassEmail}
                  onDownloadGatePass={downloadGatePass}
                  gateEmailBusy={gateEmailBusy}
                  leaveBlocked={leaveBlocked}
                  onBell={() => setNotifOpen(true)}
                  unread={notificationPage?.unread ?? 0}
                />
              )
            )}

            {tab === "leaves" && (
              <LeavesView
                cadetId={cadet?.id}
                requests={requests}
                leaveBlocked={leaveBlocked}
                onApply={() => setTab("apply")}
                onSendGatePassEmail={sendGatePassEmail}
                onDownloadGatePass={downloadGatePass}
                gateEmailBusy={gateEmailBusy}
                onOpenPass={openGatePass}
              />
            )}

            {tab === "apply" && (
              <ApplyView
                cadetId={cadet?.id}
                leaveBlocked={leaveBlocked}
                blockReason={cadet?.leave_blocked_reason ?? undefined}
                onSuccess={() => setTab("leaves")}
              />
            )}

            {tab === "pass" && (
              <PassView
                cadet={cadet}
                leave={latestApprovedLeave}
                onDownloadGatePass={downloadGatePass}
                onSendGatePassEmail={sendGatePassEmail}
                gateEmailBusy={gateEmailBusy}
                onApply={() => setTab("apply")}
              />
            )}

            {tab === "profile" && (
              <ProfileView
                name={profileName}
                rollNo={rollNo}
                department={department}
                cadet={cadet}
                requests={requests}
                onFaceEnroll={openFaceEnrollment}
                onEditProfile={editProfile}
                onSignOut={signOut}
                onDeleteAccount={deleteAccount}
                onNavigateToRewards={() => setTab("rewards")}
                onNavigateToRanks={() => setTab("ranks")}
              />
            )}

            {tab === "rewards" && <RewardsView onBack={() => setTab("profile")} />}
            {tab === "ranks" && <RanksView name={profileName} onBack={() => setTab("profile")} />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Floating Bottom Navigation Bar (Mobile) */}
      <CadetBottomNav tab={tab} setTab={setTab} onApplyAction={() => setTab("apply")} />

      {/* Quick Action Drawer for shore leave if opened */}
      <ShoreLeaveDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        cadetId={cadet?.id}
        leaveBlocked={leaveBlocked}
        blockReason={cadet?.leave_blocked_reason ?? undefined}
      />

      {/* Notifications modal */}
      <NotificationsSheet open={notifOpen} onOpenChange={setNotifOpen} />
    </div>
  );
}

/* =========================== TOP HEADER =========================== */
function CadetTopHeader({
  name,
  rollNo,
  tab,
  setTab,
  unread,
  onBell,
  onSignOut,
}: {
  name: string;
  rollNo: string;
  tab: TabKey;
  setTab: (t: TabKey) => void;
  unread: number;
  onBell: () => void;
  onSignOut: () => void;
}) {
  const initials = name.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase() || "C";

  return (
    <header className="sticky top-0 z-40 bg-white/70 backdrop-blur-xl border-b border-blue-100/50">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Left branding */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="text-xs font-extrabold uppercase tracking-widest text-[#0077f6]">
              AMET IST
            </span>
            <span className="text-base font-extrabold tracking-tight text-slate-900 leading-tight">
              ShoreLeave
            </span>
          </div>
          <span className="hidden sm:inline-flex rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-[#0077f6] border border-blue-100">
            Cadet
          </span>
        </div>

        {/* Center Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1 bg-white/90 rounded-full p-1 border border-slate-200/80 shadow-sm">
          {[
            { key: "home", label: "Home" },
            { key: "leaves", label: "Leaves" },
            { key: "apply", label: "Apply" },
            { key: "pass", label: "Pass" },
            { key: "profile", label: "Profile" },
          ].map(({ key, label }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key as TabKey)}
                className={`relative px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  active
                    ? "bg-[#0077f6] text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            );
          })}
        </nav>

        {/* Right action area */}
        <div className="flex items-center gap-2.5">
          <ShoreNotificationBell unreadCount={unread} onClick={onBell} />
          <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-slate-200">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-[#0077f6] text-white text-xs font-bold shadow-sm">
              {initials}
            </div>
            <div className="text-left hidden lg:block leading-tight">
              <div className="text-xs font-bold text-slate-900 truncate max-w-[120px]">{name}</div>
              <div className="text-[10px] font-medium text-slate-500">{rollNo}</div>
            </div>
            <button
              onClick={onSignOut}
              title="Sign out"
              className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

/* =========================== FLOATING BOTTOM NAV (MOBILE) =========================== */
function CadetBottomNav({
  tab,
  setTab,
  onApplyAction,
}: {
  tab: TabKey;
  setTab: (t: TabKey) => void;
  onApplyAction: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 md:hidden pointer-events-none flex justify-center px-4 pb-4">
      <div className="pointer-events-auto relative flex w-full max-w-md items-center justify-between rounded-full bg-white/95 px-3 py-2 shadow-[0_12px_40px_-10px_rgba(15,23,42,0.18)] border border-slate-200/90 backdrop-blur-xl">
        {/* Home */}
        <button
          onClick={() => setTab("home")}
          className={`flex flex-1 flex-col items-center justify-center py-1 transition-colors ${
            tab === "home" ? "text-[#0077f6]" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Home className="h-5 w-5" />
          <span className="mt-1 text-[10px] font-bold">Home</span>
        </button>

        {/* Leaves */}
        <button
          onClick={() => setTab("leaves")}
          className={`flex flex-1 flex-col items-center justify-center py-1 transition-colors ${
            tab === "leaves" ? "text-[#0077f6]" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <FileText className="h-5 w-5" />
          <span className="mt-1 text-[10px] font-bold">Leaves</span>
        </button>

        {/* Central Floating Apply Button */}
        <div className="relative -mt-8 flex flex-col items-center">
          <button
            onClick={onApplyAction}
            aria-label="Apply for leave"
            className="grid h-14 w-14 place-items-center rounded-full bg-[#0077f6] text-white shadow-[0_8px_24px_rgba(0,119,246,0.45)] transition-transform active:scale-95 hover:bg-[#0062cc]"
          >
            <Plus className="h-7 w-7 stroke-[2.5]" />
          </button>
          <span className="mt-1 text-[10px] font-bold text-slate-700">Apply</span>
        </div>

        {/* Pass */}
        <button
          onClick={() => setTab("pass")}
          className={`flex flex-1 flex-col items-center justify-center py-1 transition-colors ${
            tab === "pass" ? "text-[#0077f6]" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <QrCode className="h-5 w-5" />
          <span className="mt-1 text-[10px] font-bold">Pass</span>
        </button>

        {/* Profile */}
        <button
          onClick={() => setTab("profile")}
          className={`flex flex-1 flex-col items-center justify-center py-1 transition-colors ${
            tab === "profile" ? "text-[#0077f6]" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <User className="h-5 w-5" />
          <span className="mt-1 text-[10px] font-bold">Profile</span>
        </button>
      </div>
    </div>
  );
}

/* =========================== LEAVE BLOCKED BANNER =========================== */
function LeaveBlockedBanner({ cadet }: { cadet: Cadet }) {
  const date = cadet.leave_blocked_date ? new Date(cadet.leave_blocked_date).toLocaleDateString() : "Not recorded";
  const until = cadet.leave_blocked_until ? new Date(cadet.leave_blocked_until).toLocaleDateString() : "Until manually restored";
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-6 rounded-3xl border border-rose-200 bg-rose-50/80 p-5 text-slate-900 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-rose-600 text-white">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <div className="text-base font-bold text-rose-900">Your leave privileges are currently suspended.</div>
          <div className="mt-1 text-sm text-slate-600">Reason: {cadet.leave_blocked_reason || "Administrative Hold"}</div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs font-semibold text-slate-500">
            <span>Blocked on: {date}</span>
            <span>Expiry: {until}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* =========================== 1. HOME VIEW (MATCHES APK EXACTLY) =========================== */
function HomeView({
  name,
  requests,
  cadet,
  onApply,
  onOpenLeave,
  onOpenGatePass,
  onViewLeaves,
  onSendGatePassEmail,
  onDownloadGatePass,
  gateEmailBusy,
  leaveBlocked,
  onBell,
  unread,
}: {
  name: string;
  requests: LeaveRequest[];
  cadet?: Cadet;
  onApply: () => void;
  onOpenLeave: () => void;
  onOpenGatePass: () => void;
  onViewLeaves: () => void;
  onSendGatePassEmail: (leave?: LeaveRequest) => void | Promise<void>;
  onDownloadGatePass: (leave?: LeaveRequest) => void;
  gateEmailBusy: boolean;
  leaveBlocked: boolean;
  onBell: () => void;
  unread: number;
}) {
  const latestApproved = requests.find((r) => r.status === "approved");
  const pendingLeave = requests.find((r) => r.status === "pending");
  const currentLeave = latestApproved || pendingLeave;
  const tokenBalance = cadet?.leave_token_balance;

  // Month label for token wallet (e.g. "OCTOBER 2026")
  const currentMonthLabel = (tokenBalance?.monthLabel || new Date().toLocaleString("en-US", { month: "long", year: "numeric" })).toUpperCase();
  const allocated = tokenBalance?.allocation ?? tokenBalance?.monthlyAllocation ?? 28;
  const available = tokenBalance?.available ?? cadet?.leave_tokens ?? 23;
  const used = tokenBalance?.used ?? tokenBalance?.consumed ?? 0;
  const reserved = tokenBalance?.reserved ?? 5;

  return (
    <div className="space-y-6">
      {/* Top Identity and Greeting (matches APK) */}
      <div className="pt-2">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
              Home
            </h1>
            <p className="mt-1 text-sm font-medium text-slate-500">
              AMET IST - Cadet overview
            </p>
            <p className="mt-2 text-base sm:text-lg font-semibold text-slate-800">
              {getGreeting(name)}
            </p>
          </div>
          <div className="md:hidden">
            <ShoreNotificationBell unreadCount={unread} onClick={onBell} />
          </div>
        </div>
      </div>

      {/* Featured "YOUR NEXT STEP" Card (matches APK) */}
      <div className="relative">
        <div className="overflow-hidden rounded-[28px] bg-gradient-to-br from-[#54a0f7] via-[#2f88f5] to-[#1670ea] p-6 text-white shadow-[0_14px_36px_-10px_rgba(22,112,234,0.38)] border border-blue-400/30">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-900/80 text-white font-extrabold text-sm shadow-inner">
                OK
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-white/80">
                  YOUR NEXT STEP
                </span>
                <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-white">
                  {latestApproved
                    ? "Gate pass ready"
                    : pendingLeave
                    ? "Leave pending review"
                    : "Ready for shore leave"}
                </h2>
                <p className="mt-1 text-sm font-medium text-white/90">
                  {latestApproved
                    ? `${latestApproved.reason || "Medical Leave"} - ${new Date(latestApproved.start_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`
                    : pendingLeave
                    ? `${pendingLeave.destination} - Pending HOD approval`
                    : "No pending leaves. Apply when you need an outing."}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={latestApproved ? onOpenGatePass : pendingLeave ? onViewLeaves : onApply}
              className="rounded-full bg-white px-5 py-2 text-sm font-bold text-slate-900 shadow-md hover:bg-slate-50 transition-transform active:scale-95"
            >
              {latestApproved ? "View details" : pendingLeave ? "Track status" : "Apply now"}
            </button>
          </div>
        </div>
      </div>

      {/* "OCTOBER 2026 TOKEN WALLET" Card (matches APK) */}
      <ShoreCard variant="default" padding="lg">
        <div className="flex flex-col">
          <div className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">
            {currentMonthLabel} TOKEN WALLET
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-extrabold text-slate-900">
            {allocated} allocated · {available} available
          </div>
          <div className="mt-1 text-sm font-medium text-slate-500">
            Used {used} · Reserved {reserved} · No carry-over
          </div>
        </div>
      </ShoreCard>

      {/* Prominent Primary Blue Action Button (matches APK) */}
      <div className="pt-1">
        <ShoreButton
          variant="primary"
          size="xl"
          fullWidth
          onClick={latestApproved ? onOpenGatePass : onApply}
          className="shadow-lg shadow-blue-500/25 text-base sm:text-lg"
        >
          {latestApproved ? "View gate pass ->" : "Apply for leave ->"}
        </ShoreButton>
      </div>

      {/* Leave Overview Cards Section */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">
            Recent Requests
          </h3>
          <button
            type="button"
            onClick={onViewLeaves}
            className="text-xs font-bold text-[#0077f6] hover:underline"
          >
            See all
          </button>
        </div>

        {requests.length === 0 ? (
          <ShoreCard variant="subtle" padding="lg" className="text-center">
            <p className="text-sm font-medium text-slate-600">
              No leave requests submitted yet.
            </p>
            <button
              onClick={onApply}
              className="mt-3 text-xs font-bold text-[#0077f6] hover:underline"
            >
              Submit your first leave application
            </button>
          </ShoreCard>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {requests.slice(0, 4).map((r) => {
              const startFormatted = new Date(r.start_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
              const endFormatted = new Date(r.end_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
              const isApproved = r.status === "approved";

              return (
                <ShoreCard key={r.id} variant="default" padding="md" className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      {r.reason || "Shore Leave"}
                    </span>
                    <ShoreStatusBadge status={r.status} size="sm" />
                  </div>

                  <div>
                    <div className="text-sm font-extrabold text-slate-900">
                      {startFormatted} to {endFormatted}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <MapPin className="h-3.5 w-3.5 text-slate-400" />
                      <span>{r.destination}</span>
                    </div>
                  </div>

                  {isApproved && (
                    <div className="pt-2 flex items-center gap-2 border-t border-slate-100">
                      <button
                        onClick={() => onDownloadGatePass(r)}
                        className="text-xs font-bold text-[#0077f6] hover:underline"
                      >
                        Download pass
                      </button>
                      <span className="text-slate-300">·</span>
                      <button
                        onClick={() => onSendGatePassEmail(r)}
                        disabled={gateEmailBusy}
                        className="text-xs font-bold text-slate-600 hover:text-slate-900"
                      >
                        {gateEmailBusy ? "Sending…" : "Email pass"}
                      </button>
                    </div>
                  )}
                </ShoreCard>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================== 2. LEAVES VIEW =========================== */
function LeavesView({
  cadetId,
  requests,
  leaveBlocked,
  onApply,
  onSendGatePassEmail,
  onDownloadGatePass,
  gateEmailBusy,
  onOpenPass,
}: {
  cadetId?: string;
  requests: LeaveRequest[];
  leaveBlocked: boolean;
  onApply: () => void;
  onSendGatePassEmail: (leave?: LeaveRequest) => void;
  onDownloadGatePass: (leave?: LeaveRequest) => void;
  gateEmailBusy: boolean;
  onOpenPass: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "active" | "rejected">("all");

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (filter === "all") return true;
      if (filter === "active") return r.status === "approved" || r.status === "out";
      return r.status === filter;
    });
  }, [requests, filter]);

  return (
    <div className="space-y-6">
      <ShorePageHeader
        title="My Leaves"
        subtitle="Track requests and past leave"
        actions={
          <ShoreButton variant="primary" size="md" onClick={onApply} disabled={leaveBlocked}>
            <Plus className="h-4 w-4" /> Apply for Leave
          </ShoreButton>
        }
      />

      {/* Filter Pills (matches APK) */}
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {[
          { key: "all", label: "All" },
          { key: "pending", label: "Pending" },
          { key: "approved", label: "Approved" },
          { key: "active", label: "Active" },
          { key: "rejected", label: "Rejected" },
        ].map(({ key, label }) => (
          <ShoreFilterPill
            key={key}
            label={label}
            active={filter === key}
            onClick={() => setFilter(key as any)}
          />
        ))}
      </div>

      {/* Leave Cards Grid */}
      {filteredRequests.length === 0 ? (
        <ShoreEmptyState
          icon={<FileText className="h-8 w-8" />}
          title="No leaves found"
          description={
            filter === "all"
              ? "You haven't submitted any leave applications yet."
              : `No leaves match the "${filter}" filter.`
          }
          actionLabel="Apply for Leave"
          onAction={onApply}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filteredRequests.map((r) => {
            const startStr = new Date(r.start_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
            const endStr = new Date(r.end_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
            const isApproved = r.status === "approved";

            return (
              <ShoreCard key={r.id} variant="default" padding="lg" className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    {r.reason || "Shore Leave"}
                  </span>
                  <ShoreStatusBadge status={r.status} />
                </div>

                <div>
                  <h4 className="text-lg font-extrabold text-slate-900">
                    {startStr} to {endStr}
                  </h4>
                  <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
                    <MapPin className="h-4 w-4 text-slate-400" />
                    <span>{r.destination}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <span className="text-xs text-slate-400 font-mono">
                    ID: {String(r.id).slice(0, 8)}
                  </span>

                  <div className="flex items-center gap-2">
                    {isApproved ? (
                      <>
                        <button
                          type="button"
                          onClick={onOpenPass}
                          className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-[#0077f6] hover:bg-blue-100 transition-colors"
                        >
                          View Pass
                        </button>
                        <button
                          type="button"
                          onClick={() => onDownloadGatePass(r)}
                          className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 transition-colors"
                        >
                          Download
                        </button>
                      </>
                    ) : (
                      <span className="text-xs font-medium text-slate-500">
                        {r.status === "pending" ? "Awaiting Review" : "Request Closed"}
                      </span>
                    )}
                  </div>
                </div>
              </ShoreCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* =========================== 3. APPLY VIEW =========================== */
type LeaveDocumentPayload = {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
};

async function readLeaveDocument(file: File): Promise<LeaveDocumentPayload> {
  const allowed = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
  if (!allowed.includes(file.type)) {
    throw new Error("Invalid format. Please upload a PDF, JPG, or PNG document.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("File exceeds 10 MB limit.");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
  return { name: file.name, type: file.type, size: file.size, dataUrl };
}

function ApplyView({
  cadetId,
  leaveBlocked,
  blockReason,
  onSuccess,
}: {
  cadetId?: string;
  leaveBlocked: boolean;
  blockReason?: string;
  onSuccess: () => void;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [destination, setDestination] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [type, setType] = useState("Home Leave");
  const [selectedDocument, setSelectedDocument] = useState<LeaveDocumentPayload | null>(null);
  const [documentError, setDocumentError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);

  const documentRequired = type === "Medical Leave";
  const tokenRule =
    type === "Home Leave" || type === "Personal Leave"
      ? "1 token / chargeable day"
      : type === "Sunday Shore Leave"
      ? "1 token / Sunday"
      : "0 tokens";

  const quoteQuery = useQuery({
    queryKey: ["cadet", "leave-token-quote", type, start, end],
    enabled: Boolean(start && end),
    queryFn: () =>
      apiRequest<{
        calculation: { requiredTokens: number; message?: string };
        balance: LeaveTokenBalance;
        remainingAfterApproval: number;
      }>(endpoints.cadet.leaveTokenQuote, {
        method: "POST",
        body: JSON.stringify({
          leaveType: type,
          fromDate: start,
          toDate: end,
          fromTime: start ? new Date(start).toTimeString().slice(0, 5) : "",
          toTime: end ? new Date(end).toTimeString().slice(0, 5) : "",
        }),
      }),
    retry: false,
  });

  const mut = useMutation({
    mutationFn: async () => {
      if (!cadetId) throw new Error("No cadet profile linked");
      if (leaveBlocked) {
        throw new Error(blockReason || "Your leave privileges are currently suspended.");
      }
      if (documentRequired && !selectedDocument) {
        throw new Error(`${type} leave requires a supporting document.`);
      }
      const from = new Date(start);
      const to = new Date(end);
      setUploadProgress(selectedDocument ? 35 : 0);
      await apiRequest<MutationResult>(endpoints.leaveRequests, {
        method: "POST",
        body: JSON.stringify({
          leaveType: type,
          fromDate: from.toISOString(),
          toDate: to.toISOString(),
          fromTime: from.toTimeString().slice(0, 5),
          toTime: to.toTimeString().slice(0, 5),
          returnDate: to.toISOString(),
          dest: destination,
          reason: reason || destination,
          document: selectedDocument,
        }),
      });
      setUploadProgress(selectedDocument ? 100 : 0);
    },
    onSuccess: () => {
      toast.success("Leave request submitted successfully");
      qc.invalidateQueries({ queryKey: queryKeys.cadet.leaveRequests(cadetId) });
      qc.invalidateQueries({ queryKey: ["cadet", "leave-token-quote"] });
      onSuccess();
    },
    onError: (error: unknown) => {
      setUploadProgress(0);
      toast.error(getErrorMessage(error, "Failed to submit leave request"));
    },
  });

  async function handleDocumentChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setDocumentError("");
      setSelectedDocument(await readLeaveDocument(file));
      setUploadProgress(0);
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Document could not be selected");
      setSelectedDocument(null);
      setDocumentError(message);
      event.target.value = "";
    }
  }

  function removeDocument() {
    setSelectedDocument(null);
    setDocumentError("");
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (leaveBlocked) {
    return (
      <div className="max-w-2xl mx-auto">
        <ShoreCard variant="default" padding="xl" className="text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-rose-50 text-rose-600">
            <Lock className="h-8 w-8" />
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900">Leave Applications Disabled</h2>
          <p className="mt-2 text-sm text-slate-500 leading-relaxed">
            Your leave privileges are currently suspended. Reason: {blockReason || "Administrative Hold"}. Please contact the duty officer.
          </p>
        </ShoreCard>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <ShorePageHeader
        title="Apply for Leave"
        subtitle="Submit your leave application for faculty & duty officer review"
      />

      <ShoreCard variant="default" padding="lg">
        <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="space-y-6">
          {/* Leave Type Selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Leave Type
              </label>
              <span className="text-xs font-semibold text-[#0077f6]">
                {tokenRule}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(["Home Leave", "Medical Leave", "Emergency Leave", "Personal Leave", "Sunday Shore Leave"] as const).map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setType(t)}
                  className={`rounded-2xl px-4 py-3 text-xs font-bold transition-all text-center ${
                    type === t
                      ? "bg-[#0077f6] text-white shadow-md shadow-blue-500/25"
                      : "bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200/60"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ShoreInput
              label="Start Date & Time"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
            <ShoreInput
              label="End Date & Time"
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
            />
          </div>

          {/* Destination */}
          <ShoreInput
            label="Destination"
            placeholder="e.g. Bangalore, Chennai, Home Address"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            required
            icon={<MapPin className="h-4 w-4" />}
          />

          {/* Reason */}
          <ShoreInput
            label="Reason for Leave"
            placeholder="Provide details about your purpose of travel"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />

          {/* Token Quote calculation */}
          <div className="rounded-2xl bg-blue-50/60 border border-blue-100 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-[#0077f6]">
              Token Requirement
            </div>
            {quoteQuery.isError ? (
              <p className="mt-1 text-xs text-rose-600 font-medium">
                {getErrorMessage(quoteQuery.error, "Token calculation unavailable.")}
              </p>
            ) : quoteQuery.data ? (
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-white p-2 shadow-sm">
                  <div className="text-lg font-extrabold text-slate-900">{quoteQuery.data.calculation.requiredTokens}</div>
                  <div className="text-[10px] uppercase font-bold text-slate-500">Required</div>
                </div>
                <div className="rounded-xl bg-white p-2 shadow-sm">
                  <div className="text-lg font-extrabold text-emerald-600">{quoteQuery.data.balance.available ?? 0}</div>
                  <div className="text-[10px] uppercase font-bold text-slate-500">Available</div>
                </div>
                <div className="rounded-xl bg-white p-2 shadow-sm">
                  <div className="text-lg font-extrabold text-[#0077f6]">{quoteQuery.data.remainingAfterApproval}</div>
                  <div className="text-[10px] uppercase font-bold text-slate-500">Remaining</div>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                Select start and end dates to preview token usage.
              </p>
            )}
          </div>

          {/* Supporting Documents */}
          <div className="rounded-2xl bg-slate-50 border border-slate-200/80 p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Supporting Document {documentRequired && <span className="text-rose-600">(Required)</span>}
                </span>
                <p className="text-xs text-slate-500 mt-0.5">PDF or image up to 10 MB</p>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-slate-900 border border-slate-200 shadow-sm hover:bg-slate-50"
              >
                {selectedDocument ? "Replace" : "Upload"}
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={handleDocumentChange}
              className="hidden"
            />
            {documentError && <p className="mt-2 text-xs font-bold text-rose-600">{documentError}</p>}
            {selectedDocument && (
              <div className="mt-3 flex items-center justify-between rounded-xl bg-white p-3 border border-slate-200">
                <span className="text-xs font-bold text-slate-800 truncate max-w-[200px]">
                  {selectedDocument.name}
                </span>
                <button
                  type="button"
                  onClick={removeDocument}
                  className="text-xs font-bold text-rose-500 hover:text-rose-700"
                >
                  Remove
                </button>
              </div>
            )}
          </div>

          {/* Submit Button */}
          <ShoreButton
            variant="primary"
            size="xl"
            fullWidth
            loading={mut.isPending}
            type="submit"
          >
            Submit Leave Application
          </ShoreButton>
        </form>
      </ShoreCard>
    </div>
  );
}

/* =========================== 4. DIGITAL PASS VIEW =========================== */
function PassView({
  cadet,
  leave,
  onDownloadGatePass,
  onSendGatePassEmail,
  gateEmailBusy,
  onApply,
}: {
  cadet?: Cadet;
  leave?: LeaveRequest;
  onDownloadGatePass: (leave?: LeaveRequest) => void;
  onSendGatePassEmail: (leave?: LeaveRequest) => void;
  gateEmailBusy: boolean;
  onApply: () => void;
}) {
  if (!leave) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <ShorePageHeader
          title="Digital Gate Pass"
          subtitle="Official campus exit pass with verification code"
        />
        <ShoreEmptyState
          icon={<QrCode className="h-10 w-10 text-[#0077f6]" />}
          title="No Active Gate Pass"
          description="You do not have an approved leave pass ready for checkout. Once your leave is approved by the HOD, your digital pass will appear here."
          actionLabel="Apply for Leave"
          onAction={onApply}
        />
      </div>
    );
  }

  const startStr = new Date(leave.start_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const endStr = new Date(leave.end_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const passId = `AMET-PASS-${String(leave.id).slice(0, 8).toUpperCase()}`;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <ShorePageHeader
        title="Digital Gate Pass"
        subtitle="Official AMET movement pass and QR credential"
      />

      {/* Main Digital Pass Card */}
      <ShoreCard
        variant="default"
        padding="xl"
        className="relative overflow-hidden border-2 border-[#0077f6]/20 shadow-xl"
      >
        {/* Pass Top Branding */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-widest text-[#0077f6]">
              AMET UNIVERSITY
            </div>
            <div className="text-lg font-extrabold text-slate-900">
              OFFICIAL SHORE PASS
            </div>
          </div>
          <ShoreStatusBadge status={leave.status} />
        </div>

        {/* QR Code Presentation */}
        <div className="my-6 flex flex-col items-center justify-center p-6 bg-slate-50/70 rounded-3xl border border-slate-100">
          <div className="grid h-44 w-44 place-items-center rounded-2xl bg-white p-3 shadow-md border border-slate-200">
            <QrCode className="h-36 w-36 text-slate-900" />
          </div>
          <div className="mt-3 font-mono text-sm font-extrabold text-slate-800 tracking-wider">
            {passId}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-medium">
            Scan at AMET main gate biometric terminal
          </div>
        </div>

        {/* Pass Details */}
        <div className="grid grid-cols-2 gap-4 text-left border-t border-slate-100 pt-4">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Cadet Name</span>
            <div className="text-sm font-bold text-slate-900">{cadet?.full_name || "Cadet"}</div>
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Roll / Reg Number</span>
            <div className="text-sm font-bold text-slate-900">{cadet?.cadet_code || "—"}</div>
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Leave Type</span>
            <div className="text-sm font-bold text-slate-900">{leave.reason || "Shore Leave"}</div>
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Destination</span>
            <div className="text-sm font-bold text-slate-900">{leave.destination}</div>
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Departure</span>
            <div className="text-sm font-semibold text-slate-800">{startStr}</div>
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Valid Return Until</span>
            <div className="text-sm font-semibold text-slate-800">{endStr}</div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t border-slate-100">
          <ShoreButton
            variant="primary"
            size="lg"
            icon={<Download className="h-4 w-4" />}
            onClick={() => onDownloadGatePass(leave)}
          >
            Download Pass PDF
          </ShoreButton>
          <ShoreButton
            variant="secondary"
            size="lg"
            loading={gateEmailBusy}
            icon={<Mail className="h-4 w-4" />}
            onClick={() => onSendGatePassEmail(leave)}
          >
            Send to Registered Email
          </ShoreButton>
        </div>
      </ShoreCard>
    </div>
  );
}

/* =========================== 5. PROFILE VIEW =========================== */
function ProfileView({
  name,
  rollNo,
  department,
  cadet,
  requests,
  onFaceEnroll,
  onEditProfile,
  onSignOut,
  onDeleteAccount,
  onNavigateToRewards,
  onNavigateToRanks,
}: {
  name: string;
  rollNo: string;
  department: string;
  cadet?: Cadet;
  requests: LeaveRequest[];
  onFaceEnroll: () => void;
  onEditProfile: () => void;
  onSignOut: () => void;
  onDeleteAccount: () => void;
  onNavigateToRewards: () => void;
  onNavigateToRanks: () => void;
}) {
  const initials = name.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase() || "C";
  const faceEnrolled = !!cadet?.face_enrolled;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <ShorePageHeader
        title="Cadet Profile"
        subtitle="Manage your identity, security and academy preferences"
      />

      {/* Main Identity Card */}
      <ShoreCard variant="default" padding="lg">
        <div className="flex items-center gap-5">
          <div className="grid h-20 w-20 shrink-0 place-items-center rounded-3xl bg-[#0077f6] text-2xl font-extrabold text-white shadow-md">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-xl font-extrabold text-slate-900 truncate">{name}</h3>
            <p className="text-xs font-bold uppercase tracking-wider text-[#0077f6] mt-0.5">
              Roll No · {rollNo}
            </p>
            <p className="text-xs font-medium text-slate-500 mt-0.5">{department}</p>
            {cadet?.email && (
              <p className="text-xs text-slate-400 mt-1 truncate">{cadet.email}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onEditProfile}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
            title="Edit details"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>
      </ShoreCard>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <ShoreStatCard
          label="Total Leaves"
          value={requests.length}
          tone="blue"
        />
        <ShoreStatCard
          label="Leave Tokens"
          value={cadet?.leave_tokens ?? 23}
          tone="emerald"
        />
        <ShoreStatCard
          label="Compliance"
          value="98%"
          tone="blue"
        />
      </div>

      {/* Biometric Status Card */}
      <ShoreCard variant="default" padding="md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`grid h-11 w-11 place-items-center rounded-2xl ${faceEnrolled ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
              <ScanFace className="h-6 w-6" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">Face Verification</div>
              <div className="text-xs text-slate-500">
                {faceEnrolled ? "Biometric enrolled & active" : "Enrollment required for automated gate"}
              </div>
            </div>
          </div>
          <ShoreStatusBadge status={faceEnrolled ? "approved" : "pending"} size="sm" />
        </div>
      </ShoreCard>

      {/* Gamification shortcuts (Rewards & Leaderboard) */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onNavigateToRewards}
          className="flex items-center justify-between rounded-3xl bg-white p-5 border border-slate-100 shadow-sm hover:shadow-md transition-all text-left"
        >
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-50 text-amber-600">
              <Gift className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">Rewards & Loot</div>
              <div className="text-[11px] text-slate-500">Open crates</div>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-400" />
        </button>

        <button
          type="button"
          onClick={onNavigateToRanks}
          className="flex items-center justify-between rounded-3xl bg-white p-5 border border-slate-100 shadow-sm hover:shadow-md transition-all text-left"
        >
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-50 text-[#0077f6]">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">Leaderboard</div>
              <div className="text-[11px] text-slate-500">Rank #4 this month</div>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-400" />
        </button>
      </div>

      {/* Security Actions */}
      <div className="space-y-3 pt-2">
        <ShoreButton variant="secondary" size="lg" fullWidth onClick={onSignOut}>
          <LogOut className="h-4 w-4" /> Sign Out
        </ShoreButton>
        <button
          type="button"
          onClick={onDeleteAccount}
          className="w-full text-center text-xs font-semibold text-rose-600 hover:underline py-2"
        >
          Delete cadet account data
        </button>
      </div>
    </div>
  );
}

/* =========================== REWARDS VIEW =========================== */
function RewardsView({ onBack }: { onBack: () => void }) {
  const [opening, setOpening] = useState(false);
  const [revealed, setRevealed] = useState<null | { tier: string; prize: string }>(null);

  function openCrate() {
    setOpening(true); setRevealed(null);
    setTimeout(() => { setOpening(false); setRevealed({ tier: "Epic", prize: "Movie pass · 2 tickets" }); }, 1600);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="text-xs font-bold text-[#0077f6] hover:underline flex items-center gap-1">
          ← Back to Profile
        </button>
      </div>
      <ShorePageHeader title="Rewards & Loot" subtitle="Open monthly loot crates earned through high compliance" />
      <ShoreCard variant="default" padding="xl" className="text-center">
        <div className="mx-auto mb-4 grid h-24 w-24 place-items-center rounded-3xl bg-blue-50 text-[#0077f6]">
          <Package className="h-12 w-12" />
        </div>
        <h3 className="text-xl font-bold text-slate-900">Monthly Cadet Crate</h3>
        <p className="mt-1 text-sm text-slate-500">Available based on on-time gate return streak</p>
        <div className="mt-6 flex justify-center">
          <ShoreButton variant="primary" size="lg" loading={opening} onClick={openCrate}>
            {opening ? "Opening crate…" : "Open Crate"}
          </ShoreButton>
        </div>
        {revealed && (
          <div className="mt-4 rounded-2xl bg-emerald-50 p-4 border border-emerald-200 text-emerald-800">
            <span className="text-xs font-bold uppercase">{revealed.tier} Reward</span>
            <div className="text-lg font-extrabold">{revealed.prize}</div>
            <p className="text-xs mt-1">Collect from the campus administration office.</p>
          </div>
        )}
      </ShoreCard>
    </div>
  );
}

/* =========================== RANKS VIEW =========================== */
function RanksView({ name, onBack }: { name: string; onBack: () => void }) {
  const board = [
    { rank: 1, name: "Arjun M.", xp: 1820 },
    { rank: 2, name: "Vikram S.", xp: 1740 },
    { rank: 3, name: "Rohit K.", xp: 1685 },
    { rank: 4, name, xp: 1620, me: true },
    { rank: 5, name: "Sahil P.", xp: 1590 },
    { rank: 6, name: "Karan D.", xp: 1530 },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="text-xs font-bold text-[#0077f6] hover:underline flex items-center gap-1">
          ← Back to Profile
        </button>
      </div>
      <ShorePageHeader title="Cadet Leaderboard" subtitle="AMET monthly punctuality and movement compliance rank" />
      <ShoreCard variant="default" padding="none" className="overflow-hidden">
        <div className="divide-y divide-slate-100">
          {board.map((item) => (
            <div
              key={item.rank}
              className={`flex items-center justify-between px-6 py-4 ${
                item.me ? "bg-blue-50/70" : "bg-white"
              }`}
            >
              <div className="flex items-center gap-4">
                <span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-extrabold ${
                  item.rank === 1 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"
                }`}>
                  {item.rank}
                </span>
                <span className="text-sm font-bold text-slate-900">
                  {item.name} {item.me && "(You)"}
                </span>
              </div>
              <span className="text-sm font-extrabold text-[#0077f6]">
                {item.xp} pts
              </span>
            </div>
          ))}
        </div>
      </ShoreCard>
    </div>
  );
}

/* =========================== SHORE LEAVE QUICK DRAWER =========================== */
function ShoreLeaveDrawer({
  open,
  onOpenChange,
  cadetId,
  leaveBlocked,
  blockReason,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cadetId?: string;
  leaveBlocked: boolean;
  blockReason?: string;
}) {
  const [destination, setDestination] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: async () => {
      if (!cadetId) throw new Error("No cadet profile linked");
      if (leaveBlocked) {
        throw new Error(blockReason || "Your leave privileges are currently suspended.");
      }
      await apiRequest<MutationResult>(endpoints.cadet.shoreLeaveRequest, {
        method: "POST",
        body: JSON.stringify({ destination, reason: reason || "Shore leave" }),
      });
    },
    onSuccess: () => {
      setSubmitted(true);
      qc.invalidateQueries({ queryKey: queryKeys.cadet.leaveRequests(cadetId) });
      setTimeout(() => {
        onOpenChange(false);
        setSubmitted(false);
        setDestination("");
        setReason("");
      }, 1800);
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to submit request")),
  });

  return (
    <ShoreModal
      open={open}
      onClose={() => onOpenChange(false)}
      title="Quick Shore Leave"
      subtitle="Standard same-day campus exit pass (Return by 18:00)"
    >
      {leaveBlocked ? (
        <div className="rounded-2xl bg-rose-50 p-4 border border-rose-200 text-rose-800 text-sm">
          Leave suspended. Reason: {blockReason || "Administrative Hold"}.
        </div>
      ) : !submitted ? (
        <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="space-y-4">
          <ShoreInput
            label="Destination"
            placeholder="e.g. Marina Mall, Beach, ECR"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            required
          />
          <ShoreInput
            label="Reason"
            placeholder="Purpose of leave"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-3 border border-slate-100 text-center">
            <div>
              <div className="text-[10px] font-bold uppercase text-slate-500">Departure</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">Now</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase text-slate-500">Return Deadline</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">18:00 IST</div>
            </div>
          </div>
          <div className="pt-2">
            <ShoreButton variant="primary" size="lg" fullWidth loading={mut.isPending} type="submit">
              Generate Shore Pass
            </ShoreButton>
          </div>
        </form>
      ) : (
        <div className="py-6 text-center">
          <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-3xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h4 className="text-lg font-extrabold text-slate-900">Pass Generated!</h4>
          <p className="text-xs text-slate-500 mt-1">Your shore leave pass is ready on your dashboard.</p>
        </div>
      )}
    </ShoreModal>
  );
}

/* =========================== NOTIFICATIONS MODAL =========================== */
function NotificationsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.cadet.notifications,
    queryFn: () => apiRequest<NotificationPage>(endpoints.notifications.list("?limit=50")),
    enabled: open,
  });

  const markAll = useMutation({
    mutationFn: () => apiRequest(endpoints.notifications.markAllRead, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.cadet.notifications }),
  });

  const items = data?.notifications ?? [];

  return (
    <ShoreModal
      open={open}
      onClose={() => onOpenChange(false)}
      title="Notifications"
      subtitle="Latest updates regarding your leave and gate passes"
    >
      <div className="space-y-3">
        {items.length > 0 && (
          <div className="flex justify-end">
            <button
              onClick={() => markAll.mutate()}
              className="text-xs font-bold text-[#0077f6] hover:underline"
            >
              Mark all as read
            </button>
          </div>
        )}
        {isLoading ? (
          <p className="py-8 text-center text-xs text-slate-500">Loading notifications…</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500">No notifications yet.</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {items.map((n) => (
              <div
                key={n.notificationId}
                className={`p-3.5 rounded-2xl border transition-colors ${
                  n.read ? "bg-white border-slate-100" : "bg-blue-50/60 border-blue-200"
                }`}
              >
                <div className="text-xs font-bold text-slate-900">{n.title}</div>
                <div className="text-xs text-slate-600 mt-0.5 leading-relaxed">{n.message}</div>
                <div className="text-[10px] text-slate-400 mt-1.5 font-medium">
                  {new Date(n.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ShoreModal>
  );
}

/* =========================== ONBOARDING =========================== */
function Onboarding({ step, setStep, name }: { step: OnboardStep; setStep: (s: OnboardStep) => void; name: string }) {
  if (step === "attention") return <AttentionStep name={name} onDone={() => setStep("done")} />;

  return (
    <div className="relative grid min-h-screen place-items-center bg-[#f0f7ff] px-6 text-slate-900">
      <ShoreCard variant="default" padding="xl" className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-blue-50 text-[#0077f6]">
          <Sparkles className="h-8 w-8" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
          Welcome, {name.split(" ")[0]}!
        </h1>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed">
          Welcome to the AMET ShoreLeave Cadet Portal. Review leave status, manage your token wallet, and verify gate passes.
        </p>
        <div className="mt-6">
          <ShoreButton variant="primary" size="lg" fullWidth onClick={() => setStep("done")}>
            Get Started
          </ShoreButton>
        </div>
      </ShoreCard>
    </div>
  );
}

function AttentionStep({ name, onDone }: { name: string; onDone: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[#f0f7ff] px-4">
      <ShoreCard variant="default" padding="xl" className="w-full max-w-md text-center">
        <h2 className="text-xl font-extrabold text-slate-900">Notice for {name}</h2>
        <p className="mt-2 text-xs text-slate-500">
          Please adhere to academy shore leave return policies and curfew times.
        </p>
        <div className="mt-5">
          <ShoreButton variant="primary" size="md" fullWidth onClick={onDone}>
            I Understand
          </ShoreButton>
        </div>
      </ShoreCard>
    </div>
  );
}

/* =========================== FACE LOGIN VERIFICATION =========================== */
type CameraStatus = "idle" | "requesting" | "ready" | "denied" | "unavailable" | "error";
type VerificationLocation = { latitude: number; longitude: number; accuracy?: number };
type VerificationStatus = "waiting" | "ready" | "submitting" | "failed";
type VerificationState = { status: VerificationStatus; guidance: string };

const defaultVerificationState: VerificationState = {
  status: "waiting",
  guidance: "Opening camera…",
};

const FACE_VERIFICATION_TIPS = [
  "Face the camera directly",
  "Keep your face inside the circle",
  "Ensure good lighting",
  "Remove sunglasses",
  "Hold still",
];

function requestVerificationLocation(): Promise<VerificationLocation | undefined> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }),
      () => resolve(undefined),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}

function FaceLoginVerification({ onVerified, onCancel }: { onVerified: (token: string) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const [cameraError, setCameraError] = useState<string>("");
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [verification, setVerification] = useState<VerificationState>(defaultVerificationState);
  const [backendMessage, setBackendMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    void startCamera();
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTipIndex((current) => (current + 1) % FACE_VERIFICATION_TIPS.length);
    }, 3000);
    return () => window.clearInterval(interval);
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
    logCameraRuntime("cadet-face-verification", "startCamera:before-request");
    stopCamera();
    try {
      setCameraError("");
      setCameraStatus("requesting");
      setBackendMessage("");
      setVerification({ status: "waiting", guidance: "Opening camera…" });
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
      setVerification({
        status: "ready",
        guidance: "Camera ready. Align your face and press Capture & Verify.",
      });
      setBackendMessage("");
      setCameraStatus("ready");
      logCameraRuntime("cadet-face-verification", "startCamera:ready");
    } catch (error: unknown) {
      logCameraRuntime("cadet-face-verification", "startCamera:error", error);
      const issue = getCameraRuntimeIssue(error, "face verification");
      setCameraStatus(issue.status);
      setCameraError(issue.message);
    }
  }

  function captureFrame(): string | null {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || cameraStatus !== "ready") {
      setCameraError("Open the camera before capturing your face.");
      return null;
    }
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    if (!video.videoWidth || !video.videoHeight) {
      setCameraError("Camera is still warming up. Try again in a moment.");
      return null;
    }
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.92);
  }

  async function verifyFace(imageBase64: string) {
    if (!imageBase64) {
      toast.error("Face frame was not captured");
      return;
    }
    try {
      setBusy(true);
      setBackendMessage("");
      setVerification({ status: "submitting", guidance: "Verifying biometrics with InsightFace…" });
      const tempToken = TokenService.getCadetFaceToken();
      if (!tempToken) throw new Error("Face verification session expired. Please sign in again.");
      const location = await requestVerificationLocation();
      const response = await cadetVerifyFace({ imageBase64, location }, tempToken);
      if (!response.token) throw new Error(response.message || "Face verification did not return a cadet token");
      toast.success("Face verified. Opening dashboard.");
      stopCamera();
      onVerified(response.token);
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Face verification failed");
      setBackendMessage(message);
      setVerification({ status: "failed", guidance: "Verification failed. Adjust your face position and capture again." });
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  function captureAndVerifyManually() {
    const frame = captureFrame();
    if (!frame) return;
    void verifyFace(frame);
  }

  function cancelFaceVerification() {
    stopCamera();
    TokenService.removeCadetFaceToken();
    onCancel();
  }

  return (
    <div className="fixed inset-0 z-[9999] h-[100dvh] w-[100dvw] overflow-hidden bg-slate-950 text-white flex flex-col justify-between p-6">
      <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-cover opacity-60" />

      {/* Top Header */}
      <div className="relative z-10 flex items-center justify-between">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-[#38bdf8]">
            AMET IST
          </span>
          <h2 className="text-xl font-black">Face Verification</h2>
        </div>
        <button
          onClick={cancelFaceVerification}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/20 backdrop-blur text-white hover:bg-white/30"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Face Frame Oval */}
      <div className="relative z-10 mx-auto h-72 w-56 rounded-full border-4 border-dashed border-sky-400/80 shadow-[0_0_50px_rgba(56,189,248,0.3)] flex items-center justify-center" />

      {/* Guidance and Action Button */}
      <div className="relative z-10 max-w-md mx-auto w-full space-y-4">
        <div className="rounded-2xl bg-slate-900/80 p-3 text-center backdrop-blur border border-slate-700">
          <p className="text-xs text-slate-300 font-medium">
            {busy ? "Verifying biometrics…" : cameraStatus === "ready" ? FACE_VERIFICATION_TIPS[tipIndex] : verification.guidance}
          </p>
        </div>

        {cameraStatus === "ready" ? (
          <ShoreButton
            variant="primary"
            size="xl"
            fullWidth
            loading={busy}
            onClick={captureAndVerifyManually}
            icon={<Camera className="h-5 w-5" />}
          >
            Capture & Verify Face
          </ShoreButton>
        ) : (
          <ShoreButton
            variant="secondary"
            size="xl"
            fullWidth
            loading={cameraStatus === "requesting"}
            onClick={startCamera}
          >
            Retry Camera
          </ShoreButton>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
