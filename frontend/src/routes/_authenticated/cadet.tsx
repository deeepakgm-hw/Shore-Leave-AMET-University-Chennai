import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Sparkles, LogOut, Calendar, KeyRound, ScanFace, Plus, Loader2,
  Home, Trophy, User, Bell, Anchor, Camera, MapPinned,
  ArrowRight, Check, X, Coins, Gift, Flame, Star, ChevronRight,
  Crown, Medal, TrendingUp, Clock, Lock, Pencil,
  CheckCircle2, AlertCircle, PartyPopper, Package, ArrowUpRight,
} from "lucide-react";
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

/* ------------------------------- Klarna palette --------------------------
   INK   #17061E   near-black aubergine text / primary button
   CREAM #F5EFE6   page background
   PAPER #FFFFFF   card surface
   PINK  #F4C7C7   blob accent
   MINT  #C9DAB8   blob accent
   LILAC #D6C3F0   blob accent
   BUTTR #F5D76E   accent tile
   PEACH #F2A488   accent tile
   ------------------------------------------------------------------------- */

type TabKey = "home" | "leave" | "rewards" | "ranks" | "profile";
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
  gamification?: { leaveTokens?: number; maxLeaveTokens?: number };
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
    return <div className="grid min-h-screen place-items-center bg-[#F5EFE6]"><Loader2 className="h-8 w-8 animate-spin text-[#17061E]" aria-label="Loading cadet profile" /></div>;
  }

  const rollNo = cadet?.cadet_code ?? "NDA-0000";
  const department = cadet?.branch ?? "Executive";
  const leaveBlocked = !!cadet?.leave_blocked;
  const openLeave = () => {
    if (leaveBlocked) {
      toast.error("Your leave privileges are currently suspended.");
      setTab("leave");
      return;
    }
    setDrawerOpen(true);
  };
  const latestApprovedLeave = requests.find((request) => request.status === "approved");
  const openGatePass = () => {
    if (leaveBlocked) {
      toast.error("Your leave privileges are currently suspended.");
      setTab("leave");
      return;
    }
    if (!latestApprovedLeave) {
      toast.info("No approved gate pass is ready yet. Check your leave status first.");
      setTab("leave");
      return;
    }
    const url = getGatePassDownloadUrl(latestApprovedLeave);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    toast.info("Gate pass PDF is issued after gate check-out verification.");
    setTab("leave");
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
      setTab("leave");
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
    <div className="relative min-h-screen bg-[#F5EFE6] text-[#17061E] antialiased">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col pb-28 sm:max-w-lg">
        <KlarnaTopBar
          name={profileName}
          rollNo={rollNo}
          unread={notificationPage?.unread ?? 0}
          onBell={() => setNotifOpen(true)}
          onSignOut={signOut}
        />

        <main className="flex-1 px-5 pt-2">
          {!cadet && (
            <div className="mb-4 rounded-3xl border border-[#17061E]/10 bg-[#F5D76E]/40 p-4 text-[13px] leading-relaxed text-[#17061E]/80">
              Your account isn't linked to a cadet record yet. Ask an administrator to assign your cadet profile.
            </div>
          )}
          {cadet?.leave_blocked && <LeaveBlockedBanner cadet={cadet} />}

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              {tab === "home" && (requestsLoading ? <div className="py-16 text-center text-sm">Loading leave requests…</div> : <HomeTab name={profileName} requests={requests} onApply={() => setTab("leave")} onOpenLeave={openLeave} onOpenGatePass={openGatePass} onOpenFaceEnrollment={openFaceEnrollment} onViewActivity={() => setTab("leave")} onSendGatePassEmail={sendGatePassEmail} onDownloadGatePass={downloadGatePass} gateEmailBusy={gateEmailBusy} leaveBlocked={leaveBlocked} />)}
              {tab === "leave" && <LeaveTab cadetId={cadet?.id} requests={requests} leaveBlocked={leaveBlocked} blockReason={cadet?.leave_blocked_reason ?? undefined} leaveTokens={cadet?.leave_tokens ?? 4} maxLeaveTokens={cadet?.max_leave_tokens ?? 8} />}
              {tab === "rewards" && <RewardsTab />}
              {tab === "ranks" && <RanksTab name={profileName} />}
              {tab === "profile" && <ProfileTab name={profileName} rollNo={rollNo} department={department} faceEnrolled={!!cadet?.face_enrolled} requests={requests} onFaceEnroll={openFaceEnrollment} onEditProfile={editProfile} onSignOut={signOut} onDeleteAccount={deleteAccount} />}
            </motion.div>
          </AnimatePresence>
        </main>

        <KlarnaTabBar tab={tab} setTab={setTab} />
      </div>

      <ShoreLeaveDrawer open={drawerOpen} onOpenChange={setDrawerOpen} cadetId={cadet?.id} leaveBlocked={leaveBlocked} blockReason={cadet?.leave_blocked_reason ?? undefined} />
      <NotificationsSheet open={notifOpen} onOpenChange={setNotifOpen} />
    </div>
  );
}

function LeaveBlockedBanner({ cadet }: { cadet: Cadet }) {
  const date = cadet.leave_blocked_date ? new Date(cadet.leave_blocked_date).toLocaleDateString() : "Not recorded";
  const until = cadet.leave_blocked_until ? new Date(cadet.leave_blocked_until).toLocaleDateString() : "Until manually restored";
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4 rounded-[28px] border border-[#C05B4D]/30 bg-[#F2A488]/35 p-4 text-[#17061E]">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#17061E] text-[#F5EFE6]"><Lock className="h-5 w-5" /></div>
        <div>
          <div className="text-[14px] font-extrabold">Your leave privileges are currently suspended.</div>
          <div className="mt-1 text-[12px] leading-relaxed text-[#17061E]/70">Reason: {cadet.leave_blocked_reason || "Administrative Hold"}</div>
          <div className="mt-2 grid gap-1 text-[11px] font-semibold text-[#17061E]/60">
            <span>Blocked on: {date}</span>
            <span>Expiry: {until}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ================================ TOP BAR ================================ */
function KlarnaTopBar({ name, rollNo, unread, onBell, onSignOut }: { name: string; rollNo: string; unread: number; onBell: () => void; onSignOut: () => void }) {
  const first = name.split(" ")[0] ?? "Cadet";
  const initials = name.split(" ").map(s => s[0]).join("").slice(0,2).toUpperCase() || "C";
  return (
    <header className="sticky top-0 z-30 bg-[#F5EFE6]/85 px-5 pb-3 backdrop-blur-xl" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-[#F4C7C7] text-[#17061E]">
            <span className="text-sm font-bold">{initials}</span>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#17061E]/50">Hi, {first}</div>
            <div className="truncate text-[15px] font-semibold leading-tight">Roll · {rollNo}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onBell} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative grid h-10 w-10 place-items-center rounded-full bg-white text-[#17061E] ring-1 ring-[#17061E]/10">
            <Bell className="h-[18px] w-[18px]" />
            {unread > 0 && <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-[#F2A488] px-1 text-[10px] font-bold ring-2 ring-white">{Math.min(unread, 99)}</span>}
          </button>
          <button onClick={onSignOut} aria-label="Sign out" className="grid h-10 w-10 place-items-center rounded-full bg-white text-[#17061E] ring-1 ring-[#17061E]/10">
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </header>
  );
}

/* =============================== TAB BAR ================================= */
function KlarnaTabBar({ tab, setTab }: { tab: TabKey; setTab: (t: TabKey) => void }) {
  const items: { key: TabKey; label: string; icon: typeof Home }[] = [
    { key: "home", label: "Home", icon: Home },
    { key: "leave", label: "Leave", icon: Calendar },
    { key: "rewards", label: "Rewards", icon: Gift },
    { key: "ranks", label: "Ranks", icon: Trophy },
    { key: "profile", label: "Profile", icon: User },
  ];
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
      <div className="pointer-events-auto flex w-full max-w-md items-center justify-between rounded-full bg-[#17061E] px-2 py-2 shadow-[0_20px_50px_-20px_rgba(23,6,30,0.55)] sm:max-w-lg">
        {items.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="relative flex flex-1 items-center justify-center py-1"
              aria-label={label}
            >
              {active && (
                <motion.span
                  layoutId="klarnaTabPill"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  className="absolute inset-y-0 inset-x-1 rounded-full bg-[#F5EFE6]"
                />
              )}
              <span className={`relative z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-semibold ${active ? "text-[#17061E]" : "text-[#F5EFE6]/70"}`}>
                <Icon className="h-[16px] w-[16px]" />
                {active && <span>{label}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ================================ HOME TAB =============================== */
function HomeTab({
  name,
  requests,
  onApply,
  onOpenLeave,
  onOpenGatePass,
  onOpenFaceEnrollment,
  onViewActivity,
  onSendGatePassEmail,
  onDownloadGatePass,
  gateEmailBusy,
  leaveBlocked,
}: {
  name: string;
  requests: LeaveRequest[];
  onApply: () => void;
  onOpenLeave: () => void;
  onOpenGatePass: () => void;
  onOpenFaceEnrollment: () => void;
  onViewActivity: () => void;
  onSendGatePassEmail: (leave?: LeaveRequest) => void | Promise<void>;
  onDownloadGatePass: (leave?: LeaveRequest) => void;
  gateEmailBusy: boolean;
  leaveBlocked: boolean;
}) {
  const current = requests.find(r => ["pending", "approved"].includes(r.status));
  const first = name.split(" ")[0] ?? "Cadet";
  return (
    <div className="space-y-4">
      {/* Hero headline */}
      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="pt-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#17061E]/55">Shore Leave · Today</div>
        <h1 className="mt-2 text-[40px] font-extrabold leading-[0.95] tracking-tight">
          Welcome back,<br />{first}.
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[#17061E]/65">
          Your leaves, rewards and rank — all in one place.
        </p>
      </motion.section>

      {/* Compliance hero card — pink blob */}
      <ComplianceCard onOpenLeave={onOpenLeave} leaveBlocked={leaveBlocked} />

      {/* Current leave */}
      <CurrentLeaveCard leave={current} onApply={onApply} onSendGatePassEmail={onSendGatePassEmail} onDownloadGatePass={onDownloadGatePass} gateEmailBusy={gateEmailBusy} leaveBlocked={leaveBlocked} />

      {/* Two-up: crates + streak */}
      <div className="grid grid-cols-2 gap-3">
        <LootTile />
        <StreakTile />
      </div>

      {/* Quick actions row */}
      <QuickActions onApply={onApply} onOpenLeave={onOpenLeave} onOpenGatePass={onOpenGatePass} onOpenFaceEnrollment={onOpenFaceEnrollment} leaveBlocked={leaveBlocked} />

      {/* Recent activity */}
      <ActivityFeed onSeeAll={onViewActivity} />
    </div>
  );
}

function ComplianceCard({ onOpenLeave, leaveBlocked }: { onOpenLeave: () => void; leaveBlocked: boolean }) {
  const xpTarget = 72;
  const [xp, setXp] = useState(0);
  useEffect(() => { const t = setTimeout(() => setXp(xpTarget), 100); return () => clearTimeout(t); }, []);
  return (
    <div className="relative overflow-hidden rounded-[32px] bg-[#F4C7C7] p-6">
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/30" />
      <div className="relative">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[#17061E] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#F5EFE6]">
          <Star className="h-3 w-3" /> Level 8 · Cadet
        </div>
        <div className="mt-5 flex items-end gap-3">
          <div className="text-[72px] font-extrabold leading-[0.85] tracking-tight text-[#17061E]">94<span className="text-3xl">%</span></div>
          <div className="mb-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[#17061E]"><TrendingUp className="h-3 w-3" /> +4%</div>
        </div>
        <div className="mt-1 text-[12px] font-medium text-[#17061E]/70">Compliance score this week</div>

        <div className="mt-5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[#17061E]/70">
            <span>XP to next level</span>
            <span>{xp}/100</span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#17061E]/15">
            <motion.div initial={{ width: 0 }} animate={{ width: `${xp}%` }} transition={{ duration: 1.2, ease: "easeOut" }}
              className="h-full rounded-full bg-[#17061E]" />
          </div>
        </div>

        <button onClick={onOpenLeave} disabled={leaveBlocked} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#17061E] px-5 py-3.5 text-[14px] font-semibold text-[#F5EFE6] transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-55">
          {leaveBlocked ? "Leave suspended" : "Take shore leave now"} <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function CurrentLeaveCard({
  leave,
  onApply,
  onSendGatePassEmail,
  onDownloadGatePass,
  gateEmailBusy,
  leaveBlocked,
}: {
  leave?: LeaveRequest;
  onApply: () => void;
  onSendGatePassEmail: (leave?: LeaveRequest) => void | Promise<void>;
  onDownloadGatePass: (leave?: LeaveRequest) => void;
  gateEmailBusy: boolean;
  leaveBlocked: boolean;
}) {
  if (!leave) {
    return (
      <div className="rounded-[28px] bg-white p-5 ring-1 ring-[#17061E]/8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#17061E]/55">Current leave</div>
        <div className="mt-2 text-[22px] font-bold tracking-tight">No active leave</div>
        <p className="mt-1 text-[13px] text-[#17061E]/60">{leaveBlocked ? "Leave applications are disabled until administration restores access." : "Apply now to plan your next outing."}</p>
        <button onClick={onApply} disabled={leaveBlocked} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#17061E]/20 bg-transparent px-5 py-3 text-[13px] font-semibold text-[#17061E] hover:bg-[#17061E]/5 disabled:cursor-not-allowed disabled:opacity-50">
          {leaveBlocked ? "Leave suspended" : "Apply for leave"} <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    );
  }
  if (leave.status === "pending") {
    const steps = ["Applied", "Face", "HOD", "Pass"];
    const active = 1;
    return (
      <div className="rounded-[28px] bg-white p-5 ring-1 ring-[#17061E]/8">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#F2A488]">Pending</div>
            <div className="mt-1 text-[18px] font-bold">{leave.destination}</div>
          </div>
          <div className="rounded-full bg-[#F5D76E]/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#17061E]">On review</div>
        </div>
        <div className="mt-5 flex items-center">
          {steps.map((s, i) => (
            <div key={s} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <div className={`grid h-8 w-8 place-items-center rounded-full text-[11px] font-bold ${i <= active ? "bg-[#17061E] text-[#F5EFE6]" : "bg-[#17061E]/10 text-[#17061E]/50"}`}>
                  {i < active ? <Check className="h-3 w-3" /> : i + 1}
                </div>
                <span className="mt-1 text-[10px] font-medium text-[#17061E]/60">{s}</span>
              </div>
              {i < steps.length - 1 && <div className={`mx-1 h-[3px] flex-1 rounded-full ${i < active ? "bg-[#17061E]" : "bg-[#17061E]/10"}`} />}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (leave.status === "approved") {
    return (
      <div className="rounded-[28px] bg-[#C9DAB8] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#17061E]/60">Gate pass · Approved</div>
            <div className="mt-1 truncate text-[20px] font-bold tracking-tight">{leave.destination}</div>
            <div className="text-[11px] font-medium text-[#17061E]/60">SL-{String(leave.id).slice(0,6).toUpperCase()}</div>
          </div>
          <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-[#17061E] text-[#F5EFE6]">
            <KeyRound className="h-14 w-14" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onSendGatePassEmail(leave)} disabled={gateEmailBusy} className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[#17061E]/20 bg-white/60 px-3 py-2.5 text-[12px] font-semibold text-[#17061E] disabled:cursor-not-allowed disabled:opacity-60">
            {gateEmailBusy ? "Sending..." : "Send email"}
          </button>
          <button type="button" onClick={() => onDownloadGatePass(leave)} className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#17061E] px-3 py-2.5 text-[12px] font-semibold text-[#F5EFE6]">Download</button>
        </div>
      </div>
    );
  }
  return null;
}

function LootTile() {
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-[#D6C3F0] p-5">
      <Package className="absolute -bottom-3 -right-3 h-24 w-24 text-[#17061E]/15" />
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#17061E]/60">Loot crates</div>
      <div className="mt-2 text-[36px] font-extrabold leading-none tracking-tight">3</div>
      <div className="mt-1 text-[12px] font-medium text-[#17061E]/60">Ready to open</div>
    </div>
  );
}

function StreakTile() {
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-[#F5D76E] p-5">
      <Flame className="absolute -bottom-3 -right-3 h-24 w-24 text-[#17061E]/15" />
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#17061E]/60">Streak</div>
      <div className="mt-2 text-[36px] font-extrabold leading-none tracking-tight">12<span className="text-lg">d</span></div>
      <div className="mt-1 text-[12px] font-medium text-[#17061E]/60">Keep it burning</div>
    </div>
  );
}

function QuickActions({
  onApply,
  onOpenLeave,
  onOpenGatePass,
  onOpenFaceEnrollment,
  leaveBlocked,
}: {
  onApply: () => void;
  onOpenLeave: () => void;
  onOpenGatePass: () => void;
  onOpenFaceEnrollment: () => void;
  leaveBlocked: boolean;
}) {
  const actions = [
    { icon: Anchor, label: "Shore leave", cta: onOpenLeave, blocked: true },
    { icon: Plus, label: "Apply leave", cta: onApply, blocked: true },
    { icon: KeyRound, label: "Gate pass", cta: onOpenGatePass, blocked: true },
    { icon: ScanFace, label: "Face check", cta: onOpenFaceEnrollment },
  ];
  return (
    <div className="rounded-[28px] bg-white p-4 ring-1 ring-[#17061E]/8">
      <div className="grid grid-cols-4 gap-2">
        {actions.map(a => (
          <button key={a.label} onClick={a.cta} disabled={leaveBlocked && a.blocked} className="flex flex-col items-center gap-1.5 rounded-2xl py-3 transition-colors hover:bg-[#F5EFE6] disabled:cursor-not-allowed disabled:opacity-45">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#F5EFE6] text-[#17061E]">
              <a.icon className="h-[18px] w-[18px]" />
            </span>
            <span className="text-[11px] font-semibold text-[#17061E]">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ActivityFeed({ onSeeAll }: { onSeeAll: () => void }) {
  const items = [
    { text: "On-time return", xp: "+50", pos: true, when: "Today · 17:52" },
    { text: "Late check-in", xp: "-30", pos: false, when: "Yesterday · 21:14" },
    { text: "Crate unlocked", xp: "+20", pos: true, when: "Mon · 09:10" },
    { text: "Streak +1", xp: "+10", pos: true, when: "Sun · 18:00" },
  ];
  return (
    <div className="rounded-[28px] bg-white p-5 ring-1 ring-[#17061E]/8">
      <div className="flex items-center justify-between">
        <div className="text-[15px] font-bold">Recent activity</div>
        <button type="button" onClick={onSeeAll} className="text-[11px] font-semibold text-[#17061E]/60 hover:text-[#17061E]">See all</button>
      </div>
      <ul className="mt-3 divide-y divide-[#17061E]/8">
        {items.map((i, idx) => (
          <li key={idx} className="flex items-center justify-between py-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">{i.text}</div>
              <div className="text-[11px] font-medium text-[#17061E]/50">{i.when}</div>
            </div>
            <span className={`text-[13px] font-bold ${i.pos ? "text-[#3B7A57]" : "text-[#C05B4D]"}`}>{i.xp}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ================================ LEAVE TAB ============================== */
function LeaveTab({ cadetId, requests, leaveBlocked, blockReason, leaveTokens, maxLeaveTokens }: { cadetId?: string; requests: LeaveRequest[]; leaveBlocked: boolean; blockReason?: string; leaveTokens: number; maxLeaveTokens: number }) {
  const grouped = useMemo(() => {
    const g: Record<string, LeaveRequest[]> = {};
    requests.forEach(r => {
      const k = new Date(r.start_at).toLocaleString("en-US", { month: "long", year: "numeric" });
      (g[k] ||= []).push(r);
    });
    return g;
  }, [requests]);

  return (
    <div className="space-y-5">
      <PageHeadline eyebrow="Leave · Apply & track" title={<>Where are you<br />headed next?</>} />

      {/* Token wallet */}
      <div className="rounded-[28px] bg-[#17061E] p-6 text-[#F5EFE6]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#F5EFE6]/60">Leave tokens</div>
        <div className="mt-3 flex items-end justify-between">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: Math.max(1, maxLeaveTokens, leaveTokens) }).map((_, i) => (
              <Coins key={i} className={`h-6 w-6 ${i < leaveTokens ? "text-[#F5D76E]" : "text-[#F5EFE6]/25"}`} />
            ))}
          </div>
          <div className="text-right">
            <div className="text-[32px] font-extrabold leading-none">{leaveTokens}<span className="text-[16px] text-[#F5EFE6]/60">/{maxLeaveTokens}</span></div>
            <div className="text-[10px] font-medium uppercase tracking-widest text-[#F5EFE6]/50">Available</div>
          </div>
        </div>
      </div>

      {leaveBlocked ? <LeaveBlockedPanel reason={blockReason} /> : cadetId && <NewRequestForm cadetId={cadetId} />}

      <section className="rounded-[28px] bg-white p-5 ring-1 ring-[#17061E]/8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold">Leave history</h2>
          <span className="text-[11px] font-semibold text-[#17061E]/50">{requests.length} total</span>
        </div>
        {Object.keys(grouped).length === 0 && (
          <p className="rounded-2xl bg-[#F5EFE6] p-5 text-center text-[13px] text-[#17061E]/60">No requests yet.</p>
        )}
        {Object.entries(grouped).map(([month, list]) => (
          <div key={month} className="mb-4 last:mb-0">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#17061E]/50">{month}</div>
            <div className="space-y-1.5">
              {list.map((r) => {
                const tone = r.status === "approved" ? "bg-[#C9DAB8] text-[#17061E]" : r.status === "rejected" ? "bg-[#F2A488]/60 text-[#17061E]" : "bg-[#F5D76E]/70 text-[#17061E]";
                return (
                  <div key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl bg-[#F5EFE6] p-3.5">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold">{r.destination}</div>
                      <div className="text-[11px] text-[#17061E]/55">{new Date(r.start_at).toLocaleString()}</div>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${tone}`}>{r.status}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function LeaveBlockedPanel({ reason }: { reason?: string }) {
  return (
    <section className="rounded-[28px] border border-[#C05B4D]/25 bg-[#F2A488]/30 p-5 text-[#17061E]">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#17061E] text-[#F5EFE6]"><Lock className="h-5 w-5" /></div>
        <div>
          <h2 className="text-[16px] font-extrabold">Leave requests are disabled</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[#17061E]/70">
            Your leave privileges are suspended. Reason: {reason || "Administrative Hold"}. You can still view leave history, notifications, and your profile.
          </p>
        </div>
      </div>
    </section>
  );
}

/* =============================== REWARDS TAB ============================= */
function RewardsTab() {
  const [opening, setOpening] = useState(false);
  const [revealed, setRevealed] = useState<null | { tier: string; prize: string }>(null);
  function openCrate() {
    setOpening(true); setRevealed(null);
    setTimeout(() => { setOpening(false); setRevealed({ tier: "Epic", prize: "Movie pass · 2 tickets" }); }, 1600);
  }
  const badges = [
    { name: "Punctual", earned: true, prog: 100 },
    { name: "Explorer", earned: true, prog: 100 },
    { name: "Streak 30", earned: false, prog: 40 },
    { name: "Top 10", earned: true, prog: 100 },
    { name: "Veteran", earned: false, prog: 65 },
    { name: "Pathfinder", earned: false, prog: 22 },
  ];
  return (
    <div className="space-y-5">
      <PageHeadline eyebrow="Rewards · Loot & badges" title={<>Open crates,<br />earn badges.</>} />

      {/* Crate */}
      <div className="relative overflow-hidden rounded-[32px] bg-[#D6C3F0] p-6">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/40" />
        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#17061E]/60">Loot crate</div>
            <div className="inline-flex gap-1 text-[9px] font-semibold uppercase tracking-wider text-[#17061E]/50">
              {["Common", "Rare", "Epic", "Legendary"].map(t => <span key={t} className="rounded-full bg-white/50 px-2 py-0.5">{t}</span>)}
            </div>
          </div>
          <div className="mt-4 grid place-items-center py-6">
            <motion.div
              animate={opening ? { rotate: [0, -8, 8, -8, 8, 0], scale: [1, 1.05, 1.05, 1.05, 1.05, 1] } : { rotate: 0 }}
              transition={{ duration: 1.2 }}
              className="grid h-32 w-32 place-items-center rounded-[2rem] bg-[#17061E]"
            >
              <Package className="h-14 w-14 text-[#F5EFE6]" />
            </motion.div>
            <AnimatePresence>
              {revealed && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 text-center">
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-[#17061E] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#F5EFE6]"><PartyPopper className="h-3 w-3" /> {revealed.tier}</div>
                  <div className="mt-2 text-[16px] font-bold">{revealed.prize}</div>
                  <div className="text-[11px] text-[#17061E]/60">Collect from admin office</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button onClick={openCrate} disabled={opening} className="w-full rounded-full bg-[#17061E] px-5 py-3.5 text-[14px] font-semibold text-[#F5EFE6] disabled:opacity-60">
            {opening ? "Opening…" : "Open crate"}
          </button>
        </div>
      </div>

      {/* This month */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[28px] bg-[#C9DAB8] p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#17061E]/60">This month</div>
          <div className="mt-2 text-[32px] font-extrabold leading-none tracking-tight">+620</div>
          <div className="mt-1 text-[12px] font-medium text-[#17061E]/60">XP earned</div>
        </div>
        <div className="rounded-[28px] bg-white p-5 ring-1 ring-[#17061E]/8">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#17061E]/60">Growth</div>
          <div className="mt-2 inline-flex items-baseline gap-1 text-[32px] font-extrabold leading-none tracking-tight">
            +18<span className="text-lg">%</span>
          </div>
          <div className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-[#3B7A57]"><TrendingUp className="h-3 w-3" /> vs last month</div>
        </div>
      </div>

      {/* Badge grid */}
      <section className="rounded-[28px] bg-white p-5 ring-1 ring-[#17061E]/8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-bold">Badge collection</h2>
          <span className="text-[11px] font-semibold text-[#17061E]/50">{badges.filter(b => b.earned).length} of {badges.length}</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {badges.map(b => (
            <div key={b.name} className={`rounded-2xl p-3 text-center ${b.earned ? "bg-[#F5D76E]" : "bg-[#F5EFE6]"}`}>
              <div className={`mx-auto grid h-12 w-12 place-items-center rounded-full ${b.earned ? "bg-[#17061E] text-[#F5EFE6]" : "bg-white text-[#17061E]/30"}`}>
                <Medal className="h-5 w-5" />
              </div>
              <div className="mt-2 truncate text-[11px] font-bold text-[#17061E]">{b.name}</div>
              {!b.earned && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#17061E]/10">
                  <div className="h-full bg-[#17061E]" style={{ width: `${b.prog}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* XP guide */}
      <div className="rounded-[28px] bg-white p-5 ring-1 ring-[#17061E]/8">
        <div className="mb-3 text-[15px] font-bold">XP guide</div>
        <ul className="divide-y divide-[#17061E]/8">
          <li className="flex justify-between py-2.5"><span className="text-[13px] text-[#17061E]/70">On time return</span><span className="text-[13px] font-bold text-[#3B7A57]">+50</span></li>
          <li className="flex justify-between py-2.5"><span className="text-[13px] text-[#17061E]/70">Early return</span><span className="text-[13px] font-bold text-[#3B7A57]">+75</span></li>
          <li className="flex justify-between py-2.5"><span className="text-[13px] text-[#17061E]/70">Late return</span><span className="text-[13px] font-bold text-[#C05B4D]">-30</span></li>
          <li className="flex justify-between py-2.5"><span className="text-[13px] text-[#17061E]/70">Overdue</span><span className="text-[13px] font-bold text-[#C05B4D]">-100</span></li>
        </ul>
      </div>
    </div>
  );
}

/* ================================ RANKS TAB ============================== */
function RanksTab({ name }: { name: string }) {
  const board = [
    { rank: 1, name: "Arjun M.", xp: 1820 },
    { rank: 2, name: "Vikram S.", xp: 1740 },
    { rank: 3, name: "Rohit K.", xp: 1685 },
    { rank: 4, name, xp: 1620, me: true },
    { rank: 5, name: "Sahil P.", xp: 1590 },
    { rank: 6, name: "Karan D.", xp: 1530 },
    { rank: 7, name: "Nikhil J.", xp: 1495 },
    { rank: 8, name: "Ravi T.", xp: 1450 },
    { rank: 9, name: "Aman B.", xp: 1410 },
    { rank: 10, name: "Ishaan G.", xp: 1380 },
  ];
  return (
    <div className="space-y-5">
      <PageHeadline eyebrow="Ranks · Monthly board" title={<>You're #4<br />this month.</>} />

      {/* Your rank hero */}
      <div className="relative overflow-hidden rounded-[32px] bg-[#F2A488] p-6">
        <Trophy className="absolute -right-4 -bottom-4 h-32 w-32 text-[#17061E]/15" />
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#17061E]/60">Your rank</div>
        <div className="mt-2 flex items-end gap-3">
          <div className="text-[72px] font-extrabold leading-[0.85] tracking-tight">#4</div>
          <div className="mb-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[#17061E]"><TrendingUp className="h-3 w-3" /> +2 this week</div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-[#17061E]/15 pt-4">
          <Stat label="Compliance" value="94%" />
          <Stat label="XP / mo" value="620" />
          <Stat label="Streak" value="12d" />
        </div>
      </div>

      {/* Leaderboard */}
      <div className="rounded-[28px] bg-white p-5 ring-1 ring-[#17061E]/8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold">Top 10 · Monthly</h2>
          <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#17061E]/55"><Clock className="h-3 w-3" /> Resets in 9d</div>
        </div>
        <ul className="space-y-1.5">
          {board.map(r => {
            const crown = r.rank === 1 ? "text-[#F5D76E]" : r.rank === 2 ? "text-[#17061E]/60" : r.rank === 3 ? "text-[#F2A488]" : "";
            const me = r.me;
            return (
              <li key={r.rank} className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl px-4 py-3 ${me ? "bg-[#17061E] text-[#F5EFE6]" : "bg-[#F5EFE6]"}`}>
                <span className="flex w-8 items-center gap-2">
                  {r.rank <= 3 ? <Crown className={`h-4 w-4 ${me ? "text-[#F5D76E]" : crown}`} /> : <span className={`text-[12px] font-bold ${me ? "text-[#F5EFE6]/70" : "text-[#17061E]/50"}`}>{r.rank}</span>}
                </span>
                <span className="min-w-0 truncate text-[13px] font-semibold">{r.name}{me && " · You"}</span>
                <span className="text-[12px] font-bold opacity-80">{r.xp} XP</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[16px] font-bold">{value}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#17061E]/60">{label}</div>
    </div>
  );
}

/* ============================== PROFILE TAB ============================== */
function ProfileTab({
  name,
  rollNo,
  department,
  faceEnrolled,
  requests,
  onFaceEnroll,
  onEditProfile,
  onSignOut,
  onDeleteAccount,
}: {
  name: string;
  rollNo: string;
  department: string;
  faceEnrolled: boolean;
  requests: LeaveRequest[];
  onFaceEnroll: () => void;
  onEditProfile: () => void;
  onSignOut: () => void;
  onDeleteAccount: () => void;
}) {
  const total = requests.length;
  const initials = name.split(" ").map(s => s[0]).join("").slice(0,2).toUpperCase() || "C";
  const [push, setPush] = useState(true);
  const [email, setEmail] = useState(true);
  const [streak, setStreak] = useState(true);
  const [overdue, setOverdue] = useState(true);
  return (
    <div className="space-y-5">
      <PageHeadline eyebrow="Profile · Your identity" title={<>Hey,<br />{name.split(" ")[0]}.</>} />

      {/* Identity card */}
      <div className="rounded-[32px] bg-[#17061E] p-6 text-[#F5EFE6]">
        <div className="flex items-center gap-4">
          <button type="button" onClick={onEditProfile} aria-label="Request profile update" className="relative grid h-16 w-16 place-items-center rounded-2xl bg-[#F4C7C7] text-[#17061E] text-lg font-bold">
            {initials}
            <span className="absolute -bottom-1.5 -right-1.5 grid h-6 w-6 place-items-center rounded-full bg-[#F5EFE6] text-[#17061E] ring-2 ring-[#17061E]">
              <Pencil className="h-3 w-3" />
            </span>
          </button>
          <div className="min-w-0">
            <div className="truncate text-[18px] font-bold tracking-tight">{name}</div>
            <div className="mt-0.5 text-[11px] font-medium uppercase tracking-widest text-[#F5EFE6]/55">Roll · {rollNo}</div>
            <div className="text-[11px] font-medium text-[#F5EFE6]/55">{department}</div>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <MiniStat label="Total leaves" value={String(total)} tone="bg-white ring-1 ring-[#17061E]/8" />
        <MiniStat label="Days outside" value="38" tone="bg-[#F5D76E]" />
        <MiniStat label="On-time %" value="92%" tone="bg-[#C9DAB8]" />
        <MiniStat label="Longest streak" value="18d" tone="bg-[#F4C7C7]" />
      </div>

      {/* Face enrollment */}
      <div className={`rounded-[28px] p-5 ${faceEnrolled ? "bg-[#C9DAB8]" : "bg-[#F2A488]/70"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#17061E] text-[#F5EFE6]">
              <ScanFace className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[14px] font-bold">Face enrollment</div>
              <div className="text-[11px] font-medium text-[#17061E]/60">{faceEnrolled ? "Enrolled · Jul 12, 2025" : "Not enrolled yet"}</div>
            </div>
          </div>
          {!faceEnrolled && (
            <button type="button" onClick={onFaceEnroll} className="rounded-full bg-[#17061E] px-4 py-2 text-[11px] font-semibold text-[#F5EFE6]">Enroll</button>
          )}
        </div>
      </div>

      {/* Notifications */}
      <div className="rounded-[28px] bg-white p-5 ring-1 ring-[#17061E]/8">
        <div className="mb-2 text-[15px] font-bold">Notifications</div>
        <Toggle label="Push notifications" on={push} set={setPush} />
        <Toggle label="Email digest" on={email} set={setEmail} />
        <Toggle label="Streak reminders" on={streak} set={setStreak} />
        <Toggle label="Overdue alerts" on={overdue} set={setOverdue} />
      </div>

      {/* Physical prizes */}
      <div className="rounded-[28px] bg-white p-5 ring-1 ring-[#17061E]/8">
        <div className="mb-3 inline-flex items-center gap-2 text-[15px] font-bold"><Gift className="h-4 w-4" /> Physical prizes</div>
        <ul className="divide-y divide-[#17061E]/8">
          <li className="flex items-center justify-between py-2.5"><span className="text-[13px]">Movie pass · 2 tickets</span><span className="rounded-full bg-[#F5D76E]/70 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">Pending</span></li>
          <li className="flex items-center justify-between py-2.5"><span className="text-[13px]">Canteen voucher</span><span className="rounded-full bg-[#C9DAB8] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">Collected</span></li>
        </ul>
      </div>

      {/* Help + Logout */}
      <div className="rounded-[28px] bg-white p-5 ring-1 ring-[#17061E]/8">
        <div className="text-[14px] font-bold">Need help?</div>
        <p className="mt-1 text-[12px] text-[#17061E]/60">Reach out to the duty officer at the admin office for any account issues.</p>
      </div>
      <button onClick={onSignOut} className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#17061E]/20 bg-transparent px-5 py-3.5 text-[14px] font-semibold text-[#17061E] hover:bg-[#17061E]/5">
        <LogOut className="h-4 w-4" /> Log out
      </button>
      <button onClick={onDeleteAccount} className="inline-flex w-full items-center justify-center rounded-full border border-red-700/30 bg-transparent px-5 py-3 text-[13px] font-semibold text-red-800 hover:bg-red-50">
        Delete my account data
      </button>

      <p className="pt-2 text-center text-[11px] font-medium text-[#17061E]/40">
        Shore Leave · AMET campus operations
      </p>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`rounded-[24px] p-5 ${tone}`}>
      <div className="text-[28px] font-extrabold leading-none tracking-tight">{value}</div>
      <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#17061E]/60">{label}</div>
    </div>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button onClick={() => set(!on)} className="flex w-full items-center justify-between py-2.5 text-[13px] font-medium">
      <span>{label}</span>
      <span className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-[#17061E]" : "bg-[#17061E]/15"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/* =============================== PAGE HEAD =============================== */
function PageHeadline({ eyebrow, title }: { eyebrow: string; title: React.ReactNode }) {
  return (
    <div className="pt-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#17061E]/55">{eyebrow}</div>
      <h1 className="mt-2 text-[40px] font-extrabold leading-[0.95] tracking-tight">{title}</h1>
    </div>
  );
}

/* ============================ SHORE LEAVE DRAWER ========================= */
function ShoreLeaveDrawer({ open, onOpenChange, cadetId, leaveBlocked, blockReason }: { open: boolean; onOpenChange: (v: boolean) => void; cadetId?: string; leaveBlocked: boolean; blockReason?: string }) {
  const [destination, setDestination] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: async () => {
      if (!cadetId) throw new Error("No cadet profile linked");
      if (leaveBlocked) {
        const error = new Error(blockReason || "Your leave privileges are currently suspended.");
        error.name = "LEAVE_BLOCKED";
        throw error;
      }
      await apiRequest<MutationResult>(endpoints.cadet.shoreLeaveRequest, {
        method: "POST",
        body: JSON.stringify({ destination, reason: reason || "Shore leave" }),
      });
    },
    onSuccess: () => {
      setSubmitted(true);
      qc.invalidateQueries({ queryKey: queryKeys.cadet.leaveRequests(cadetId) });
      setTimeout(() => { onOpenChange(false); setSubmitted(false); setDestination(""); setReason(""); }, 2200);
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed")),
  });

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => onOpenChange(false)}
            className="fixed inset-0 z-50 bg-[#17061E]/40 backdrop-blur-sm" />
          <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-[32px] bg-[#F5EFE6] p-6 pb-8 sm:max-w-lg">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#17061E]/15" />
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#17061E]/55">Instant · Auto approval</div>
                <h2 className="mt-1 text-[26px] font-extrabold tracking-tight">Shore leave</h2>
              </div>
              <button onClick={() => onOpenChange(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white ring-1 ring-[#17061E]/10"><X className="h-4 w-4" /></button>
            </div>
            <p className="mt-1 text-[12px] text-[#17061E]/60">Returns are locked to 18:00.</p>

            {leaveBlocked ? (
              <div className="mt-6 rounded-[24px] border border-[#C05B4D]/25 bg-[#F2A488]/30 p-5">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#17061E] text-[#F5EFE6]"><Lock className="h-5 w-5" /></div>
                  <div>
                    <h3 className="text-[15px] font-extrabold">Gate pass generation is disabled</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-[#17061E]/70">
                      Your leave privileges are currently suspended. Reason: {blockReason || "Administrative Hold"}.
                    </p>
                  </div>
                </div>
              </div>
            ) : !submitted ? (
              <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="mt-5 space-y-3">
                <KField label="Destination" value={destination} onChange={setDestination} required />
                <KField label="Reason" value={reason} onChange={setReason} />
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-white p-3 ring-1 ring-[#17061E]/10">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[#17061E]/55">Time out</div>
                    <div className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-bold"><Lock className="h-3 w-3" /> Now</div>
                  </div>
                  <div className="rounded-2xl bg-white p-3 ring-1 ring-[#17061E]/10">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[#17061E]/55">Time in</div>
                    <div className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-bold"><Lock className="h-3 w-3" /> 18:00</div>
                  </div>
                </div>
                <button type="submit" disabled={mut.isPending}
                  className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#17061E] px-5 py-4 text-[14px] font-semibold text-[#F5EFE6] disabled:opacity-60">
                  {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Generate gate pass
                </button>
              </form>
            ) : (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mt-8 text-center">
                <div className="mx-auto grid h-44 w-44 place-items-center rounded-3xl bg-[#17061E] text-[#F5EFE6]">
                  <KeyRound className="h-32 w-32" />
                </div>
                <div className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-[#3B7A57]"><CheckCircle2 className="h-4 w-4" /> Pass approved</div>
                <p className="mt-1 text-[12px] text-[#17061E]/60">Use your fingerprint first. This emergency code is for manual gate verification only.</p>
              </motion.div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function KField({ label, value, onChange, required, type = "text" }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[#17061E]/55">{label}</span>
      <input required={required} value={value} type={type} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl bg-white px-4 py-3.5 text-[14px] font-medium text-[#17061E] outline-none ring-1 ring-[#17061E]/10 focus:ring-2 focus:ring-[#17061E]" />
    </label>
  );
}

/* ============================ NOTIFICATIONS SHEET ======================== */
function NotificationsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.cadet.notifications,
    queryFn: () => apiRequest<NotificationPage>(endpoints.notifications.list("?limit=50")),
    enabled: open,
  });
  const markRead = useMutation({ mutationFn: (id: string) => apiRequest(endpoints.notifications.read(id), { method: "PATCH" }), onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.cadet.notifications }) });
  const markAll = useMutation({ mutationFn: () => apiRequest(endpoints.notifications.markAllRead, { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.cadet.notifications }) });
  const items = data?.notifications ?? [];
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => onOpenChange(false)}
            className="fixed inset-0 z-50 bg-[#17061E]/40 backdrop-blur-sm" />
          <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-[32px] bg-[#F5EFE6] p-6 pb-8 sm:max-w-lg">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#17061E]/15" />
            <div className="flex items-center justify-between">
              <div><h2 className="text-[26px] font-extrabold tracking-tight">Inbox</h2><button disabled={!data?.unread} onClick={() => markAll.mutate()} className="text-xs font-semibold text-[#17061E]/60">Mark all read</button></div>
              <button onClick={() => onOpenChange(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white ring-1 ring-[#17061E]/10"><X className="h-4 w-4" /></button>
            </div>
            <ul className="mt-4 space-y-2">
              {isLoading && <li className="rounded-2xl bg-white p-4 text-sm text-[#17061E]/60">Loading notifications…</li>}
              {isError && <li className="rounded-2xl bg-white p-4 text-sm text-red-700">Could not load notifications. <button onClick={() => refetch()} className="font-bold underline">Retry</button></li>}
              {!isLoading && !isError && items.length === 0 && <li className="rounded-2xl bg-white p-5 text-center text-sm text-[#17061E]/60">No notifications yet.</li>}
              {items.map((n) => (
                <li key={n.notificationId} className={`flex gap-3 rounded-2xl bg-white p-4 ring-1 ${n.read ? "ring-[#17061E]/8" : "ring-[#F2A488]"}`} onClick={() => { if (!n.read) markRead.mutate(n.notificationId); }}>
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#F5D76E]">
                    <Bell className="h-5 w-5 text-[#17061E]" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold">{n.title}</div>
                    <div className="text-[12px] text-[#17061E]/60">{n.message}</div>
                    <time className="mt-1 block text-[10px] text-[#17061E]/40">{new Date(n.createdAt).toLocaleString()}</time>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#17061E]/30 self-center" />
                </li>
              ))}
            </ul>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ============================== ONBOARDING =============================== */
function Onboarding({ step, setStep, name }: { step: OnboardStep; setStep: (s: OnboardStep) => void; name: string }) {
  if (step === "attention") return <AttentionStep name={name} onDone={() => setStep("done")} />;

  return (
    <div className="relative grid min-h-screen place-items-center bg-[#F5EFE6] px-6 text-[#17061E]">
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
          className="w-full max-w-md">
          {step === "welcome" && (
            <>
              <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl bg-[#F4C7C7]">
                <Sparkles className="h-7 w-7 text-[#17061E]" />
              </div>
              <h1 className="text-center text-[44px] font-extrabold leading-[0.95] tracking-tight">
                Welcome,<br />{name.split(" ")[0]}.
              </h1>
              <p className="mx-auto mt-4 max-w-xs text-center text-[14px] leading-relaxed text-[#17061E]/65">
                Smart shore leave for cadets. Earn XP, badges and crates as you keep in step.
              </p>
              <div className="mt-8 space-y-3">
                <button onClick={() => setStep("permissions")} className="w-full rounded-full bg-[#17061E] px-5 py-4 text-[15px] font-semibold text-[#F5EFE6]">
                  Get started
                </button>
              </div>
            </>
          )}
          {step === "permissions" && (
            <>
              <div className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[#17061E]/55">Step 2 of 3</div>
              <h1 className="mt-3 text-center text-[36px] font-extrabold leading-[0.95] tracking-tight">
                Allow<br />permissions.
              </h1>
              <p className="mx-auto mt-3 max-w-xs text-center text-[14px] leading-relaxed text-[#17061E]/65">
                Camera and location keep your check-ins secure.
              </p>
              <div className="mt-6 space-y-2">
                <PermRow icon={Camera} label="Camera" desc="Face verification at gate" />
                <PermRow icon={MapPinned} label="Location" desc="Confirm you are inside campus" />
              </div>
              <div className="mt-6 space-y-3">
                <button onClick={() => setStep("otp")} className="w-full rounded-full bg-[#17061E] px-5 py-4 text-[15px] font-semibold text-[#F5EFE6]">
                  Allow &amp; continue
                </button>
                <button onClick={() => setStep("otp")} className="w-full rounded-full border border-[#17061E]/25 bg-transparent px-5 py-4 text-[15px] font-semibold text-[#17061E]">
                  Not now
                </button>
              </div>
            </>
          )}
          {step === "otp" && <OtpStep onDone={() => setStep("attention")} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function PermRow({ icon: Icon, label, desc }: { icon: typeof Camera; label: string; desc: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-[#17061E]/10">
      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#F5EFE6] text-[#17061E]"><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <div className="text-[14px] font-bold">{label}</div>
        <div className="text-[11px] text-[#17061E]/60">{desc}</div>
      </div>
    </div>
  );
}

function OtpStep({ onDone }: { onDone: () => void }) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  function set(i: number, v: string) {
    const cleaned = v.replace(/\D/g, "").slice(-1);
    const next = [...digits]; next[i] = cleaned; setDigits(next);
    const el = document.getElementById(`otp-${i + 1}`); if (cleaned && el) (el as HTMLInputElement).focus();
  }
  const complete = digits.every(d => d);
  return (
    <>
      <div className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[#17061E]/55">Step 3 of 3</div>
      <h1 className="mt-3 text-center text-[36px] font-extrabold leading-[0.95] tracking-tight">
        Verify<br />it's you.
      </h1>
      <p className="mx-auto mt-3 max-w-xs text-center text-[14px] leading-relaxed text-[#17061E]/65">
        We sent a 6-digit code to your registered mobile.
      </p>
      <div className="mx-auto mt-6 flex max-w-xs justify-between gap-2">
        {digits.map((d, i) => (
          <input key={i} id={`otp-${i}`} value={d} onChange={(e) => set(i, e.target.value)}
            inputMode="numeric" maxLength={1}
            className="h-14 w-11 rounded-2xl bg-white text-center text-[20px] font-bold text-[#17061E] outline-none ring-1 ring-[#17061E]/10 focus:ring-2 focus:ring-[#17061E]" />
        ))}
      </div>
      <div className="mt-6 space-y-3">
        <button disabled={!complete} onClick={onDone}
          className="w-full rounded-full bg-[#17061E] px-5 py-4 text-[15px] font-semibold text-[#F5EFE6] disabled:opacity-40">
          Verify &amp; continue
        </button>
        <button className="w-full text-center text-[12px] font-semibold text-[#17061E]/60 hover:text-[#17061E]">
          Resend code
        </button>
      </div>
    </>
  );
}

/* ============================= ATTENTION STEP ============================ */
function AttentionStep({ name, onDone }: { name: string; onDone: () => void }) {
  type Slide = { eyebrow: string; title: React.ReactNode; body: string; image: string; blob: string };
  const slides: Slide[] = [
    { eyebrow: "Attention · Shore leave", title: (<>Stay safe,<br />{name.split(" ")[0]}.</>), body: "A quick briefing from AMET before you head out. Inform the warden, sign the Shore Leave Register and always carry your gate pass.", image: panel1.url, blob: "bg-[#F4C7C7]" },
    { eyebrow: "Rules · Your wellbeing", title: (<>No sea, no wheels,<br />no shortcuts.</>), body: "Do not enter the sea or attempt to swim. No two-wheelers, driving, smoking, drinking or prohibited substances. Avoid outside food.", image: panel2.url, blob: "bg-[#C9DAB8]" },
    { eyebrow: "Return · Gate protocol", title: (<>Back by 18:00.<br />Bags checked at gate.</>), body: "Return before curfew. Shopping bags are inspected at the gate. Late returns are logged — your dashboard opens automatically.", image: panel3.url, blob: "bg-[#D6C3F0]" },
  ];
  const TOTAL_MS = 10_000;
  const perSlide = Math.floor(TOTAL_MS / slides.length);
  const slideCount = slides.length;
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(Math.ceil(TOTAL_MS / 1000));

  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const left = Math.max(0, Math.ceil((TOTAL_MS - elapsed) / 1000));
      setRemaining(left);
      const nextIdx = Math.min(slideCount - 1, Math.floor(elapsed / perSlide));
      setIndex(nextIdx);
      if (elapsed >= TOTAL_MS) { clearInterval(tick); onDone(); }
    }, 100);
    return () => clearInterval(tick);
  }, [onDone, perSlide, slideCount]);

  const s = slides[index];
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#F5EFE6] text-[#17061E]">
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-10 sm:max-w-lg">
        <div className="flex items-center gap-2">
          {slides.map((_, i) => (
            <div key={i} className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-[#17061E]/15">
              <motion.div
                key={`${i}-${index}`}
                initial={{ width: i < index ? "100%" : "0%" }}
                animate={{ width: i < index ? "100%" : i === index ? "100%" : "0%" }}
                transition={{ duration: i === index ? perSlide / 1000 : 0, ease: "linear" }}
                className="absolute inset-y-0 left-0 bg-[#17061E]"
              />
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={`copy-${index}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }} className="mt-10">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#17061E]/60">
              <AlertCircle className="h-3 w-3" /> {s.eyebrow}
            </div>
            <h1 className="mt-4 text-[44px] font-extrabold leading-[0.95] tracking-tight sm:text-[52px]">{s.title}</h1>
          </motion.div>
        </AnimatePresence>

        <div className="relative mt-8 flex flex-1 items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.div key={`img-${index}`} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }} className="relative w-full">
              <div className={`relative mx-auto aspect-[4/5] w-full max-w-[420px] overflow-hidden rounded-[36px] ${s.blob}`}>
                <img src={s.image} alt="" className="absolute inset-0 h-full w-full object-cover mix-blend-multiply" />
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <AnimatePresence mode="wait">
          <motion.p key={`body-${index}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="mt-6 text-center text-[15px] leading-relaxed text-[#17061E]/70">
            {s.body}
          </motion.p>
        </AnimatePresence>

        <div className="mt-6 space-y-3">
          <button onClick={onDone} className="w-full rounded-full bg-[#17061E] px-5 py-4 text-[15px] font-semibold text-[#F5EFE6] transition-transform hover:scale-[1.01] active:scale-[0.99]">
            I understand
          </button>
          <button onClick={() => setIndex((i) => Math.min(slides.length - 1, i + 1))} className="w-full rounded-full border border-[#17061E]/25 bg-transparent px-5 py-4 text-[15px] font-semibold text-[#17061E] transition-colors hover:bg-[#17061E]/5">
            {index < slides.length - 1 ? "Next" : "Skip"}
          </button>
          <div className="pt-1 text-center text-[11px] uppercase tracking-[0.2em] text-[#17061E]/50">
            Auto-continuing in {remaining}s
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================== NEW REQUEST FORM ============================ */
const LEAVE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const LEAVE_DOCUMENT_ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

type LeaveDocumentPayload = {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
};

function readLeaveDocument(file: File): Promise<LeaveDocumentPayload> {
  return new Promise((resolve, reject) => {
    if (!LEAVE_DOCUMENT_ALLOWED_TYPES.has(file.type)) {
      reject(new Error("Upload a PDF, JPG, JPEG, or PNG document."));
      return;
    }
    if (file.size > LEAVE_DOCUMENT_MAX_BYTES) {
      reject(new Error("Document must be 10 MB or smaller."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected document."));
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        reject(new Error("Could not read the selected document."));
        return;
      }
      resolve({ name: file.name, type: file.type, size: file.size, dataUrl });
    };
    reader.readAsDataURL(file);
  });
}

function NewRequestForm({ cadetId }: { cadetId: string }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [destination, setDestination] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [type, setType] = useState<"Shore" | "Special" | "Medical">("Special");
  const [selectedDocument, setSelectedDocument] = useState<LeaveDocumentPayload | null>(null);
  const [documentError, setDocumentError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const cost = type === "Shore" ? 1 : type === "Special" ? 2 : 0;
  const documentRequired = type === "Special" || type === "Medical";

  const mut = useMutation({
    mutationFn: async () => {
      if (documentRequired && !selectedDocument) {
        throw new Error(`${type} leave requires a supporting document.`);
      }
      const from = new Date(start);
      const to = new Date(end);
      setUploadProgress(selectedDocument ? 35 : 0);
      await apiRequest<MutationResult>(endpoints.leaveRequests, {
        method: "POST",
        body: JSON.stringify({
          leaveType: type === "Medical" ? "Medical" : type === "Special" ? "Special Leave" : "Others",
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
      toast.success("Leave request submitted");
      setDestination(""); setStart(""); setEnd(""); setReason("");
      setSelectedDocument(null);
      setDocumentError("");
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
      qc.invalidateQueries({ queryKey: queryKeys.cadet.leaveRequests(cadetId) });
    },
    onError: (error: unknown) => {
      setUploadProgress(0);
      toast.error(getErrorMessage(error, "Failed to submit"));
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

  return (
    <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="rounded-[28px] bg-white p-5 ring-1 ring-[#17061E]/8">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold">Apply for leave</h2>
        <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#17061E]/55"><Coins className="h-3 w-3" /> {cost} coin{cost !== 1 ? "s" : ""}</div>
      </div>
      <div className="mt-3 flex gap-1.5 rounded-full bg-[#F5EFE6] p-1">
        {(["Shore", "Special", "Medical"] as const).map(t => (
          <button type="button" key={t} onClick={() => setType(t)}
            className={`flex-1 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${type === t ? "bg-[#17061E] text-[#F5EFE6]" : "text-[#17061E]/60"}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-3">
        <KField label="Destination" value={destination} onChange={setDestination} required />
        <KField label="Reason" value={reason} onChange={setReason} />
        <div className="grid grid-cols-2 gap-3">
          <KField label="Start" value={start} onChange={setStart} required type="datetime-local" />
          <KField label="End" value={end} onChange={setEnd} required type="datetime-local" />
        </div>
        <div className="rounded-[24px] bg-[#F5EFE6] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#17061E]/55">
                Supporting document {documentRequired ? <span className="text-[#C05B4D]">required</span> : <span className="text-[#17061E]/40">optional</span>}
              </div>
              <div className="mt-1 text-[12px] font-medium text-[#17061E]/60">PDF, JPG, JPEG, or PNG up to 10 MB.</div>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 rounded-full bg-white px-3 py-2 text-[11px] font-bold text-[#17061E] ring-1 ring-[#17061E]/10"
            >
              {selectedDocument ? "Replace" : "Upload"}
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={handleDocumentChange} className="hidden" />
          {documentError && <div className="mt-3 rounded-2xl bg-[#F2A488]/40 p-3 text-[12px] font-semibold text-[#17061E]">{documentError}</div>}
          {selectedDocument && (
            <div className="mt-3 rounded-2xl bg-white p-3 ring-1 ring-[#17061E]/8">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold text-[#17061E]">{selectedDocument.name}</div>
                  <div className="text-[11px] text-[#17061E]/55">{selectedDocument.type} · {(selectedDocument.size / 1024 / 1024).toFixed(2)} MB</div>
                </div>
                <button type="button" onClick={removeDocument} className="grid h-8 w-8 place-items-center rounded-full bg-[#F5EFE6] text-[#17061E]" aria-label="Remove supporting document">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {selectedDocument.type.startsWith("image/") ? (
                <img src={selectedDocument.dataUrl} alt="Selected document preview" className="mt-3 max-h-40 w-full rounded-2xl object-cover" />
              ) : (
                <a href={selectedDocument.dataUrl} target="_blank" rel="noreferrer" className="mt-3 block rounded-2xl border border-[#17061E]/10 bg-[#F5EFE6] p-3 text-center text-[12px] font-bold text-[#17061E]">
                  Preview PDF
                </a>
              )}
              {uploadProgress > 0 && (
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#17061E]/10">
                  <div className="h-full rounded-full bg-[#F5D76E] transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <button type="submit" disabled={mut.isPending}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#17061E] px-5 py-3.5 text-[14px] font-semibold text-[#F5EFE6] disabled:opacity-60">
        {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
        Submit request
      </button>
    </form>
  );
}

type CameraStatus = "idle" | "requesting" | "ready" | "denied" | "unavailable" | "error";
type VerificationLocation = { latitude: number; longitude: number; accuracy?: number };
type VerificationStatus = "waiting" | "ready" | "submitting" | "failed";
type VerificationState = {
  status: VerificationStatus;
  guidance: string;
};

const defaultVerificationState: VerificationState = {
  status: "waiting",
  guidance: "Opening camera…",
};

const FACE_VERIFICATION_TIPS = [
  "Face the camera directly",
  "Keep your face inside the rectangle",
  "Ensure good lighting",
  "Remove glasses if necessary",
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
        guidance: "Camera ready. Look at the camera and press Capture & Verify.",
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
      setVerification({ status: "submitting", guidance: "Sending face frame to InsightFace…" });
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

  const showCameraPermissionDialog = !!cameraError && cameraStatus !== "ready";

  return (
    <div
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
      <div className="pointer-events-none absolute inset-0 bg-black/20" />

      <button
        type="button"
        onClick={cancelFaceVerification}
        className="absolute z-20 grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white shadow-2xl ring-1 ring-white/30 backdrop-blur transition hover:bg-white/25"
        style={{ top: "max(1rem, env(safe-area-inset-top))", right: "max(1rem, env(safe-area-inset-right))" }}
        aria-label="Cancel face verification"
      >
        <X className="h-6 w-6" />
      </button>

      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[min(58dvh,72vw,520px)] min-h-[180px] w-[min(42dvh,78vw,420px)] min-w-[180px] max-w-[calc(100dvw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-[28px] border-[3px] border-white/95 shadow-[0_0_70px_rgba(255,255,255,0.18),inset_0_0_40px_rgba(255,255,255,0.08)]" />

      <div className="absolute inset-x-0 top-0 z-10 px-5 text-center sm:px-6" style={{ paddingTop: "max(2rem, calc(env(safe-area-inset-top) + 1rem))" }}>
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-xl">
          <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] ring-1 ring-white/25 backdrop-blur">
            <ScanFace className="h-4 w-4" /> Secure check
          </div>
          <h1 className="text-[clamp(2rem,9vw,3.75rem)] font-black tracking-tight">Face Verification</h1>
          <p className="mt-3 text-[clamp(0.95rem,3vw,1.125rem)] font-medium text-white/80">Look at the camera to continue</p>
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
            aria-labelledby="cadet-camera-dialog-title"
          >
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#17061E] text-white">
              <Camera className="h-5 w-5" />
            </div>
            <h2 id="cadet-camera-dialog-title" className="mt-4 text-center text-xl font-black">Camera access is required</h2>
            <p className="mt-2 text-center text-sm text-[#17061E]/70">{cameraError}</p>
            <p className="mt-3 rounded-2xl bg-[#17061E]/5 p-3 text-xs text-[#17061E]/65">
              If your browser blocked the prompt, open site settings for this page, set Camera to Allow, then return and retry.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={startCamera} disabled={cameraStatus === "requesting"} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-[#17061E] px-5 py-3 text-sm font-extrabold text-white disabled:opacity-60">
                {cameraStatus === "requesting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                Allow Camera Again
              </button>
              <button type="button" onClick={cancelFaceVerification} className="inline-flex min-h-[48px] items-center justify-center rounded-full border border-[#17061E]/15 px-5 py-3 text-sm font-bold text-[#17061E]">
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-10 px-5 sm:px-8" style={{ paddingBottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))" }}>
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-xl rounded-[32px] bg-black/35 p-4 shadow-2xl ring-1 ring-white/20 backdrop-blur-xl sm:p-5">
          <div className="min-h-[52px] rounded-3xl bg-white/12 p-4 text-center">
            <div className="text-sm font-semibold text-white">
              {busy ? "Verifying with InsightFace…" : cameraStatus === "ready" ? FACE_VERIFICATION_TIPS[tipIndex] : verification.guidance}
            </div>
            <div className="mt-1 text-xs text-white/65">
              Backend InsightFace performs all biometric verification.
            </div>
          </div>

          {cameraError && <p className="mt-3 rounded-2xl bg-red-500/20 p-3 text-center text-xs font-semibold text-red-50 ring-1 ring-red-200/30">{cameraError}</p>}
          {backendMessage && <p className="mt-3 rounded-2xl bg-amber-400/20 p-3 text-center text-xs font-semibold text-amber-50 ring-1 ring-amber-100/30">{backendMessage}</p>}

          {cameraStatus === "ready" ? (
            <button type="button" onClick={captureAndVerifyManually} disabled={busy} className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-3 rounded-full bg-white px-6 py-4 text-base font-extrabold text-[#17061E] shadow-[0_18px_45px_-20px_rgba(255,255,255,0.7)] transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
              Capture & Verify
            </button>
          ) : (
            <button type="button" onClick={startCamera} disabled={cameraStatus === "requesting"} className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-3 rounded-full bg-white px-6 py-4 text-base font-extrabold text-[#17061E] shadow-[0_18px_45px_-20px_rgba(255,255,255,0.7)] transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60">
              {cameraStatus === "requesting" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
              {cameraStatus === "requesting" ? "Opening Camera" : "Retry Camera"}
            </button>
          )}
        </motion.div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
