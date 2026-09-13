import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  Anchor,
  Bell,
  CalendarClock,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CloudRain,
  Compass,
  Download,
  FileCheck2,
  FileText,
  Fingerprint,
  Home,
  IdCard,
  LifeBuoy,
  Lock,
  LogOut,
  MapPin,
  Moon,
  Navigation,
  Paperclip,
  Plane,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  ShipWheel,
  Sun,
  TimerReset,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/cadet")({
  head: () => ({ meta: [{ title: "Cadet · AMET IST Shore Leave" }] }),
  component: CadetMobileExperience,
});

type TabKey = "home" | "apply" | "leaves" | "gate" | "notifications";
type ThemeMode = "light" | "dark";
type LeaveStatus = "pending" | "approved" | "active" | "rejected" | "completed";
type FilterKey = "all" | LeaveStatus;
type NotificationCategory = "All" | "Leave Approval" | "Gate Pass" | "Reminder" | "System" | "Security";

type LeaveRecord = {
  id: string;
  type: string;
  destination: string;
  departure: string;
  returnAt: string;
  duration: string;
  reason: string;
  status: LeaveStatus;
  documents: string[];
};

type NotificationRecord = {
  id: string;
  category: Exclude<NotificationCategory, "All">;
  title: string;
  body: string;
  time: string;
  unread: boolean;
};

type ApplicationDraft = {
  type: string;
  departure: string;
  returnAt: string;
  address: string;
  contact: string;
  reason: string;
  documentName: string;
};

const cadet = {
  name: "Deepak G M",
  register: "AMET/IST/2026/014",
  course: "B.Tech Information Science",
  branch: "Information Science and Technology",
  batch: "2022-2026",
  email: "deepak.gm@amet.edu",
  phone: "+91 98765 43210",
  status: "LEAVE APPROVED",
};

const leaves: LeaveRecord[] = [
  {
    id: "SL-2026-0913",
    type: "Home Leave",
    destination: "Velachery, Chennai",
    departure: "13 Sep, 04:30 PM",
    returnAt: "14 Sep, 07:30 PM",
    duration: "27 hours",
    reason: "Family visit and local appointment",
    status: "approved",
    documents: ["Parent acknowledgement.pdf"],
  },
  {
    id: "SL-2026-0903",
    type: "Medical Leave",
    destination: "Apollo Clinic, OMR",
    departure: "03 Sep, 10:00 AM",
    returnAt: "03 Sep, 04:00 PM",
    duration: "6 hours",
    reason: "Medical consultation",
    status: "completed",
    documents: ["Medical note.jpg"],
  },
  {
    id: "SL-2026-0918",
    type: "Personal Leave",
    destination: "Adyar, Chennai",
    departure: "18 Sep, 02:00 PM",
    returnAt: "18 Sep, 08:00 PM",
    duration: "6 hours",
    reason: "Document collection",
    status: "pending",
    documents: [],
  },
  {
    id: "SL-2026-0828",
    type: "Emergency Leave",
    destination: "Tambaram",
    departure: "28 Aug, 03:15 PM",
    returnAt: "28 Aug, 09:00 PM",
    duration: "5h 45m",
    reason: "Urgent family requirement",
    status: "rejected",
    documents: ["Request note.pdf"],
  },
];

const notifications: NotificationRecord[] = [
  { id: "n1", category: "Leave Approval", title: "Home Leave approved", body: "Your shore leave for Velachery has been approved by HOD.", time: "4 min ago", unread: true },
  { id: "n2", category: "Gate Pass", title: "Gate pass ready", body: "Digital pass SL-2026-0913 is available for gate checkout.", time: "12 min ago", unread: true },
  { id: "n3", category: "Reminder", title: "Return window", body: "Return check-in closes at 07:30 PM tomorrow.", time: "1 hour ago", unread: false },
  { id: "n4", category: "Security", title: "Secure session verified", body: "Face verification and device trust are active for this session.", time: "Today", unread: false },
  { id: "n5", category: "System", title: "Offline mode ready", body: "Your latest gate pass can be viewed if campus network is slow.", time: "Yesterday", unread: false },
];

const activities = [
  { icon: FileText, title: "Leave request submitted", body: "Home Leave to Velachery", time: "Today, 09:16 AM" },
  { icon: ShieldCheck, title: "Leave approved", body: "HOD and security review complete", time: "Today, 11:42 AM" },
  { icon: QrCode, title: "Gate pass generated", body: "Pass ID SL-2026-0913", time: "Today, 11:44 AM" },
  { icon: TimerReset, title: "Return reminder scheduled", body: "Alert 90 minutes before return", time: "Today, 11:45 AM" },
];

const statusStyles: Record<LeaveStatus | "onCampus", { label: string; tone: string; dot: string }> = {
  onCampus: { label: "ON CAMPUS", tone: "from-slate-900 to-cyan-900", dot: "bg-cyan-300" },
  pending: { label: "LEAVE PENDING", tone: "from-amber-700 to-stone-900", dot: "bg-amber-300" },
  approved: { label: "LEAVE APPROVED", tone: "from-emerald-800 to-cyan-950", dot: "bg-emerald-300" },
  active: { label: "ON LEAVE", tone: "from-sky-800 to-indigo-950", dot: "bg-sky-300" },
  rejected: { label: "LEAVE REJECTED", tone: "from-rose-800 to-slate-950", dot: "bg-rose-300" },
  completed: { label: "LEAVE COMPLETED", tone: "from-zinc-700 to-slate-950", dot: "bg-zinc-300" },
};

const leaveTypes = ["Home Leave", "Medical Leave", "Emergency Leave", "Personal Leave", "Other Leave"];
const steps = ["Leave Type", "Date & Time", "Destination", "Reason", "Documents", "Review"] as const;

function CadetMobileExperience() {
  const [tab, setTab] = useState<TabKey>("home");
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectedLeave, setSelectedLeave] = useState<LeaveRecord | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [category, setCategory] = useState<NotificationCategory>("All");
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ApplicationDraft>({
    type: "Home Leave",
    departure: "2026-09-13T16:30",
    returnAt: "2026-09-14T19:30",
    address: "Velachery, Chennai",
    contact: "+91 98765 43210",
    reason: "Family visit and local appointment",
    documentName: "",
  });

  const approvedLeave = leaves.find((leave) => leave.status === "approved") ?? leaves[0];
  const pageTone = theme === "dark"
    ? "bg-[#071315] text-[#eefcff]"
    : "bg-[#e8f1ef] text-[#071315]";
  const shellTone = theme === "dark"
    ? "from-[#071315] via-[#0b2428] to-[#102f36]"
    : "from-[#f7fbfa] via-[#e8f1ef] to-[#c9dfdf]";

  const filteredLeaves = useMemo(() => {
    if (filter === "all") return leaves;
    return leaves.filter((leave) => leave.status === filter);
  }, [filter]);

  const filteredNotifications = useMemo(() => {
    if (category === "All") return notifications;
    return notifications.filter((item) => item.category === category);
  }, [category]);

  function updateDraft(key: keyof ApplicationDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function submitApplication() {
    setSuccessOpen(true);
    setStep(0);
    setTab("leaves");
  }

  return (
    <div className={`min-h-screen ${pageTone}`}>
      <div className={`relative mx-auto min-h-screen w-full max-w-md overflow-hidden bg-gradient-to-b ${shellTone} shadow-2xl sm:max-w-lg`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_50%_0%,rgba(126,231,218,0.34),transparent_68%)]" />
        <TopBar theme={theme} onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")} onProfile={() => setProfileOpen(true)} />
        <main className="relative z-10 px-4 pb-28 pt-3">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 18, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.985 }}
              transition={{ type: "spring", stiffness: 280, damping: 28 }}
            >
              {tab === "home" && <HomeScreen onApply={() => setTab("apply")} onGate={() => setTab("gate")} onLeaves={() => setTab("leaves")} onNotifications={() => setTab("notifications")} onProfile={() => setProfileOpen(true)} activeLeave={approvedLeave} />}
              {tab === "apply" && <ApplyScreen draft={draft} step={step} setStep={setStep} updateDraft={updateDraft} submitApplication={submitApplication} />}
              {tab === "leaves" && <LeavesScreen filter={filter} setFilter={setFilter} leaves={filteredLeaves} onSelect={setSelectedLeave} />}
              {tab === "gate" && <GatePassScreen leave={approvedLeave} />}
              {tab === "notifications" && <NotificationsScreen category={category} setCategory={setCategory} items={filteredNotifications} />}
            </motion.div>
          </AnimatePresence>
        </main>
        <BottomNav tab={tab} setTab={setTab} />
      </div>
      <AnimatePresence>
        {profileOpen && <ProfileSheet onClose={() => setProfileOpen(false)} theme={theme} />}
        {selectedLeave && <LeaveDetailSheet leave={selectedLeave} onClose={() => setSelectedLeave(null)} />}
        {successOpen && <SuccessSheet onClose={() => setSuccessOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

function TopBar({ theme, onToggleTheme, onProfile }: { theme: ThemeMode; onToggleTheme: () => void; onProfile: () => void }) {
  return (
    <header className="relative z-20 flex items-center justify-between px-4 pb-2 pt-5" style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}>
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-[18px] bg-white/12 text-cyan-100 shadow-lg ring-1 ring-white/15 backdrop-blur-xl">
          <Anchor className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-100/65">AMET IST</p>
          <h1 className="text-base font-black tracking-tight text-white">Shore Leave</h1>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <IconButton label="Toggle theme" onClick={onToggleTheme}>{theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</IconButton>
        <IconButton label="Open profile" onClick={onProfile}><User className="h-4 w-4" /></IconButton>
      </div>
    </header>
  );
}

function HomeScreen({ onApply, onGate, onLeaves, onNotifications, onProfile, activeLeave }: { onApply: () => void; onGate: () => void; onLeaves: () => void; onNotifications: () => void; onProfile: () => void; activeLeave: LeaveRecord }) {
  return (
    <div className="space-y-4">
      <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-[32px] bg-[#041113] p-5 text-white shadow-[0_30px_90px_-36px_rgba(45,212,191,0.72)] ring-1 ring-white/12">
        <div className="relative">
          <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-cyan-300/18 blur-3xl" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-cyan-100/75">Good morning,</p>
              <h2 className="mt-1 text-4xl font-black leading-none tracking-tight">{cadet.name}</h2>
            </div>
            <button type="button" onClick={onProfile} className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/12 ring-1 ring-white/15 backdrop-blur-xl" aria-label="Open cadet profile">
              <Fingerprint className="h-5 w-5 text-cyan-100" />
            </button>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 text-[12px]">
            <InfoPill label="Register" value={cadet.register} />
            <InfoPill label="Batch" value={cadet.batch} />
            <InfoPill label="Course" value={cadet.course} wide />
          </div>
        </div>
      </motion.section>

      <StatusCard status="approved" />
      <ActiveLeaveCard leave={activeLeave} onGate={onGate} />
      <QuickActions onApply={onApply} onLeaves={onLeaves} onGate={onGate} onNotifications={onNotifications} />
      <StatePreview />
      <ActivityList />
    </div>
  );
}

function InfoPill({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`${wide ? "col-span-2" : ""} rounded-2xl bg-white/9 px-3 py-2 ring-1 ring-white/10`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100/50">{label}</p>
      <p className="mt-1 truncate font-semibold text-cyan-50">{value}</p>
    </div>
  );
}

function StatusCard({ status }: { status: LeaveStatus }) {
  const style = statusStyles[status];
  return (
    <motion.section whileTap={{ scale: 0.985 }} className={`rounded-[30px] bg-gradient-to-br ${style.tone} p-5 text-white shadow-2xl ring-1 ring-white/10`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">Primary status</p>
          <div className="mt-3 flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${style.dot} shadow-[0_0_18px_currentColor]`} />
            <h3 className="text-2xl font-black tracking-tight">{style.label}</h3>
          </div>
        </div>
        <div className="grid h-16 w-16 place-items-center rounded-[24px] bg-white/12 ring-1 ring-white/15">
          <ShieldCheck className="h-8 w-8 text-cyan-100" />
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-white/68">Approved for controlled shore movement. Gate checkout opens 30 minutes before departure.</p>
    </motion.section>
  );
}

function ActiveLeaveCard({ leave, onGate }: { leave: LeaveRecord; onGate: () => void }) {
  return (
    <section className="rounded-[30px] bg-white/12 p-4 text-white shadow-xl ring-1 ring-white/12 backdrop-blur-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-100/55">Active leave window</p>
          <h3 className="mt-2 text-2xl font-black tracking-tight">{leave.destination}</h3>
          <p className="mt-1 text-sm text-white/58">{leave.type} · {leave.duration}</p>
        </div>
        <button type="button" onClick={onGate} className="grid h-12 w-12 place-items-center rounded-2xl bg-cyan-200 text-slate-950 shadow-lg shadow-cyan-900/30" aria-label="Open gate pass">
          <QrCode className="h-5 w-5" />
        </button>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <MetricCard label="Departure" value={leave.departure} icon={Plane} />
        <MetricCard label="Return" value={leave.returnAt} icon={Clock3} />
      </div>
      <div className="mt-3 rounded-[24px] bg-[#071315]/55 p-4 ring-1 ring-white/10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">Destination weather</p>
            <p className="mt-1 text-lg font-black">29 C · Light rain</p>
          </div>
          <CloudRain className="h-9 w-9 text-cyan-100" />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-white/62">
          <span className="rounded-2xl bg-white/8 px-2 py-2">Rain 42%</span>
          <span className="rounded-2xl bg-white/8 px-2 py-2">Wind 13 km/h</span>
          <span className="rounded-2xl bg-white/8 px-2 py-2">ETA 36 min</span>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Plane }) {
  return (
    <div className="rounded-[22px] bg-white/9 p-3 ring-1 ring-white/10">
      <Icon className="h-4 w-4 text-cyan-100" />
      <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/42">{label}</p>
      <p className="mt-1 text-sm font-bold leading-tight">{value}</p>
    </div>
  );
}

function QuickActions({ onApply, onLeaves, onGate, onNotifications }: { onApply: () => void; onLeaves: () => void; onGate: () => void; onNotifications: () => void }) {
  const actions = [
    { label: "Apply Leave", icon: Plus, action: onApply, tint: "bg-cyan-200 text-slate-950" },
    { label: "My Leaves", icon: FileCheck2, action: onLeaves, tint: "bg-white/12 text-white" },
    { label: "Gate Pass", icon: IdCard, action: onGate, tint: "bg-white/12 text-white" },
    { label: "Leave History", icon: CalendarClock, action: onNotifications, tint: "bg-white/12 text-white" },
  ];
  return (
    <section>
      <SectionTitle eyebrow="Fast lane" title="Quick actions" />
      <div className="grid grid-cols-2 gap-3">
        {actions.map((item, index) => (
          <motion.button
            type="button"
            key={item.label}
            onClick={item.action}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04 }}
            whileTap={{ scale: 0.96 }}
            className="group min-h-28 rounded-[28px] bg-white/10 p-4 text-left text-white ring-1 ring-white/12 backdrop-blur-xl transition hover:bg-white/14"
          >
            <span className={`grid h-11 w-11 place-items-center rounded-2xl ${item.tint}`}>
              <item.icon className="h-5 w-5" />
            </span>
            <span className="mt-4 flex items-center justify-between text-base font-black">
              {item.label}
              <ChevronRight className="h-4 w-4 text-white/45 transition group-hover:translate-x-0.5" />
            </span>
          </motion.button>
        ))}
      </div>
    </section>
  );
}

function StatePreview() {
  const states = [
    ["Loading", RefreshCw],
    ["Empty", Search],
    ["Error", X],
    ["Success", Check],
    ["Offline", CloudRain],
    ["Expired", Lock],
  ] as const;
  return (
    <section className="rounded-[28px] bg-white/10 p-4 text-white ring-1 ring-white/12 backdrop-blur-xl">
      <SectionTitle eyebrow="System states" title="Ready for real product flows" compact />
      <div className="mt-3 grid grid-cols-3 gap-2">
        {states.map(([label, Icon]) => (
          <div key={label} className="rounded-2xl bg-[#071315]/45 px-2 py-3 text-center ring-1 ring-white/8">
            <Icon className="mx-auto h-4 w-4 text-cyan-100" />
            <p className="mt-2 text-[11px] font-bold text-white/70">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ActivityList() {
  return (
    <section className="space-y-3">
      <SectionTitle eyebrow="Recent activity" title="Campus movement trail" />
      {activities.map((item, index) => (
        <motion.div key={item.title} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.05 }} className="flex gap-3 rounded-[24px] bg-white/10 p-3 text-white ring-1 ring-white/12 backdrop-blur-xl">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cyan-200/15 text-cyan-100">
            <item.icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="font-bold">{item.title}</p>
            <p className="text-sm text-white/56">{item.body}</p>
            <p className="mt-1 text-xs text-white/38">{item.time}</p>
          </div>
        </motion.div>
      ))}
    </section>
  );
}

function ApplyScreen({ draft, step, setStep, updateDraft, submitApplication }: { draft: ApplicationDraft; step: number; setStep: (step: number) => void; updateDraft: (key: keyof ApplicationDraft, value: string) => void; submitApplication: () => void }) {
  const current = steps[step];
  const progress = ((step + 1) / steps.length) * 100;
  const canBack = step > 0;
  const isReview = step === steps.length - 1;

  return (
    <section className="space-y-4 text-white">
      <div className="rounded-[32px] bg-[#041113] p-5 shadow-2xl ring-1 ring-white/12">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-100/55">Apply leave</p>
        <h2 className="mt-2 text-4xl font-black tracking-tight">Intentional, reviewed, ready.</h2>
        <div className="mt-5 h-2 rounded-full bg-white/10">
          <motion.div className="h-full rounded-full bg-cyan-200" animate={{ width: `${progress}%` }} />
        </div>
        <p className="mt-3 text-sm text-white/58">{step + 1} of {steps.length} · {current}</p>
      </div>

      <div className="rounded-[30px] bg-white/10 p-4 ring-1 ring-white/12 backdrop-blur-xl">
        <AnimatePresence mode="wait">
          <motion.div key={current} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ type: "spring", stiffness: 280, damping: 28 }}>
            {current === "Leave Type" && <LeaveTypeStep value={draft.type} onChange={(value) => updateDraft("type", value)} />}
            {current === "Date & Time" && <DateTimeStep draft={draft} updateDraft={updateDraft} />}
            {current === "Destination" && <DestinationStep draft={draft} updateDraft={updateDraft} />}
            {current === "Reason" && <ReasonStep value={draft.reason} onChange={(value) => updateDraft("reason", value)} />}
            {current === "Documents" && <DocumentsStep value={draft.documentName} onChange={(value) => updateDraft("documentName", value)} />}
            {current === "Review" && <ReviewStep draft={draft} />}
          </motion.div>
        </AnimatePresence>

        <div className="mt-5 grid grid-cols-[auto_1fr] gap-3">
          <button type="button" onClick={() => setStep(step - 1)} disabled={!canBack} className="grid h-13 w-13 place-items-center rounded-2xl bg-white/10 text-white disabled:opacity-35" aria-label="Previous step">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => (isReview ? submitApplication() : setStep(step + 1))} className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-cyan-200 px-4 font-black text-slate-950 shadow-xl shadow-cyan-950/20">
            {isReview ? <CheckCircle2 className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
            {isReview ? "Submit request" : "Continue"}
          </button>
        </div>
      </div>
    </section>
  );
}

function LeaveTypeStep({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <StepHeader icon={Compass} title="Choose leave type" body="Select the purpose that best matches the request." />
      <div className="mt-4 space-y-2">
        {leaveTypes.map((type) => (
          <button type="button" key={type} onClick={() => onChange(type)} className={`flex w-full items-center justify-between rounded-[24px] p-4 text-left ring-1 transition ${value === type ? "bg-cyan-200 text-slate-950 ring-cyan-100" : "bg-white/8 text-white ring-white/10"}`}>
            <span className="font-black">{type}</span>
            <span className={`grid h-7 w-7 place-items-center rounded-full ${value === type ? "bg-slate-950 text-cyan-100" : "bg-white/10"}`}>
              <Check className="h-4 w-4" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DateTimeStep({ draft, updateDraft }: { draft: ApplicationDraft; updateDraft: (key: keyof ApplicationDraft, value: string) => void }) {
  return (
    <div>
      <StepHeader icon={CalendarClock} title="Set movement window" body="Departure and return remain visually distinct for quick review." />
      <div className="mt-4 grid gap-3">
        <DateField label="Departure" value={draft.departure} onChange={(value) => updateDraft("departure", value)} />
        <DateField label="Return" value={draft.returnAt} onChange={(value) => updateDraft("returnAt", value)} />
      </div>
    </div>
  );
}

function DestinationStep({ draft, updateDraft }: { draft: ApplicationDraft; updateDraft: (key: keyof ApplicationDraft, value: string) => void }) {
  return (
    <div>
      <StepHeader icon={MapPin} title="Destination details" body="Designed for future location suggestions without adding backend integration now." />
      <div className="mt-4 space-y-3">
        <TextField label="Destination address" value={draft.address} onChange={(value) => updateDraft("address", value)} icon={Navigation} />
        <TextField label="Contact number" value={draft.contact} onChange={(value) => updateDraft("contact", value)} icon={ShieldCheck} />
      </div>
    </div>
  );
}

function ReasonStep({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <StepHeader icon={FileText} title="Reason for leave" body="Keep it concise, specific, and easy for reviewers to scan." />
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={6} className="mt-4 w-full resize-none rounded-[24px] border-0 bg-white/10 p-4 text-sm font-semibold text-white outline-none ring-1 ring-white/12 placeholder:text-white/35 focus:ring-cyan-200" placeholder="Enter reason" />
    </div>
  );
}

function DocumentsStep({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const hasDocument = value.length > 0;
  return (
    <div>
      <StepHeader icon={Paperclip} title="Supporting documents" body="Mock upload states are included for preview, remove, and uploaded feedback." />
      <div className="mt-4 rounded-[26px] border border-dashed border-cyan-100/35 bg-white/8 p-4">
        <div className="grid place-items-center py-5 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-[22px] bg-cyan-200 text-slate-950">
            {hasDocument ? <FileCheck2 className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
          </div>
          <p className="mt-3 font-black">{hasDocument ? value : "Add document"}</p>
          <p className="mt-1 text-sm text-white/52">PDF, JPG, JPEG, or PNG preview</p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => onChange("Parent acknowledgement.pdf")} className="rounded-2xl bg-cyan-200 px-4 py-3 text-sm font-black text-slate-950">Upload mock</button>
            {hasDocument && <button type="button" onClick={() => onChange("")} className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 text-white" aria-label="Remove document"><Trash2 className="h-4 w-4" /></button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewStep({ draft }: { draft: ApplicationDraft }) {
  return (
    <div>
      <StepHeader icon={ShieldCheck} title="Review application" body="Everything is organized before the final submission." />
      <div className="mt-4 space-y-2">
        <ReviewRow label="Cadet" value={`${cadet.name} · ${cadet.register}`} />
        <ReviewRow label="Leave type" value={draft.type} />
        <ReviewRow label="Dates" value={`${draft.departure} to ${draft.returnAt}`} />
        <ReviewRow label="Destination" value={draft.address} />
        <ReviewRow label="Reason" value={draft.reason} />
        <ReviewRow label="Documents" value={draft.documentName || "No document attached"} />
      </div>
    </div>
  );
}

function LeavesScreen({ filter, setFilter, leaves: visibleLeaves, onSelect }: { filter: FilterKey; setFilter: (filter: FilterKey) => void; leaves: LeaveRecord[]; onSelect: (leave: LeaveRecord) => void }) {
  const filters: FilterKey[] = ["all", "pending", "approved", "active", "rejected", "completed"];
  return (
    <section className="space-y-4 text-white">
      <ScreenHero eyebrow="My leaves" title="Every request, status-first." body="Filter by review state and open a complete movement timeline." icon={FileCheck2} />
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {filters.map((item) => (
          <button key={item} type="button" onClick={() => setFilter(item)} className={`shrink-0 rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.12em] ${filter === item ? "bg-cyan-200 text-slate-950" : "bg-white/10 text-white/65 ring-1 ring-white/10"}`}>
            {item}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {visibleLeaves.map((leave) => (
          <button key={leave.id} type="button" onClick={() => onSelect(leave)} className="w-full rounded-[28px] bg-white/10 p-4 text-left ring-1 ring-white/12 backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-100/52">{leave.id}</p>
                <h3 className="mt-1 text-xl font-black">{leave.type}</h3>
                <p className="mt-1 text-sm text-white/56">{leave.destination}</p>
              </div>
              <StatusBadge status={leave.status} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <MetricCard label="Departure" value={leave.departure} icon={Plane} />
              <MetricCard label="Return" value={leave.returnAt} icon={Clock3} />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function GatePassScreen({ leave }: { leave: LeaveRecord }) {
  return (
    <section className="space-y-4 text-white">
      <ScreenHero eyebrow="Gate pass" title="Official digital movement pass." body="A polished pass surface for secure gate checkout and return check-in." icon={IdCard} />
      <motion.div initial={{ rotateX: 8, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} className="overflow-hidden rounded-[34px] bg-[#f7fbfa] p-5 text-slate-950 shadow-[0_36px_120px_-42px_rgba(125,249,232,0.9)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-teal-800/55">AMET IST Shore Leave Pass</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight">{cadet.name}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">{cadet.register}</p>
          </div>
          <div className="grid h-14 w-14 place-items-center rounded-[22px] bg-slate-950 text-cyan-100">
            <ShipWheel className="h-7 w-7" />
          </div>
        </div>
        <div className="my-5 border-t border-dashed border-slate-300" />
        <div className="grid grid-cols-2 gap-3">
          <PassField label="Destination" value={leave.destination} />
          <PassField label="Status" value="Approved" />
          <PassField label="Departure" value={leave.departure} />
          <PassField label="Return" value={leave.returnAt} />
        </div>
        <div className="mt-5 grid grid-cols-[1fr_auto] gap-4">
          <div className="rounded-[24px] bg-slate-950 p-4 text-white">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-100/55">Gate Pass ID</p>
            <p className="mt-2 text-xl font-black">{leave.id}</p>
            <p className="mt-3 text-xs leading-relaxed text-white/58">QR visual is a frontend placeholder. Verification remains a later backend integration.</p>
          </div>
          <div className="grid h-28 w-28 grid-cols-4 gap-1 rounded-[22px] bg-white p-3 ring-1 ring-slate-200">
            {Array.from({ length: 16 }).map((_, index) => (
              <span key={index} className={`rounded-[4px] ${index % 3 === 0 || index % 5 === 0 ? "bg-slate-950" : "bg-cyan-100"}`} />
            ))}
          </div>
        </div>
      </motion.div>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="inline-flex min-h-13 items-center justify-center gap-2 rounded-[22px] bg-cyan-200 font-black text-slate-950"><Download className="h-5 w-5" /> Save</button>
        <button type="button" className="inline-flex min-h-13 items-center justify-center gap-2 rounded-[22px] bg-white/10 font-black text-white ring-1 ring-white/12"><Camera className="h-5 w-5" /> Preview</button>
      </div>
    </section>
  );
}

function NotificationsScreen({ category, setCategory, items }: { category: NotificationCategory; setCategory: (category: NotificationCategory) => void; items: NotificationRecord[] }) {
  const categories: NotificationCategory[] = ["All", "Leave Approval", "Gate Pass", "Reminder", "System", "Security"];
  return (
    <section className="space-y-4 text-white">
      <ScreenHero eyebrow="Notifications" title="Clear, calm, actionable." body="Unread messages stand forward while read messages stay available." icon={Bell} />
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {categories.map((item) => (
          <button key={item} type="button" onClick={() => setCategory(item)} className={`shrink-0 rounded-full px-4 py-2 text-xs font-black ${category === item ? "bg-cyan-200 text-slate-950" : "bg-white/10 text-white/64 ring-1 ring-white/10"}`}>
            {item}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <article key={item.id} className={`rounded-[26px] p-4 ring-1 backdrop-blur-xl ${item.unread ? "bg-cyan-200 text-slate-950 ring-cyan-100" : "bg-white/10 text-white ring-white/12"}`}>
            <div className="flex items-start gap-3">
              <div className={`mt-1 h-2.5 w-2.5 rounded-full ${item.unread ? "bg-slate-950" : "bg-white/35"}`} />
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] opacity-60">{item.category}</p>
                <h3 className="mt-1 font-black">{item.title}</h3>
                <p className="mt-1 text-sm opacity-70">{item.body}</p>
                <p className="mt-2 text-xs font-bold opacity-52">{item.time}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProfileSheet({ onClose, theme }: { onClose: () => void; theme: ThemeMode }) {
  const settings = [
    ["Security", Lock],
    ["Notification Preferences", Bell],
    ["Help & Support", LifeBuoy],
    ["Privacy", ShieldCheck],
    ["Terms", FileText],
    ["Logout", LogOut],
  ] as const;
  return (
    <SheetFrame onClose={onClose}>
      <div className="rounded-[32px] bg-white p-5 text-slate-950">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-teal-800/55">Cadet profile</p>
            <h2 className="mt-2 text-3xl font-black">{cadet.name}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">{cadet.register}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100" aria-label="Close profile">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5 grid gap-2">
          <ReviewRow label="Course" value={cadet.course} light />
          <ReviewRow label="Branch" value={cadet.branch} light />
          <ReviewRow label="Batch" value={cadet.batch} light />
          <ReviewRow label="Email" value={cadet.email} light />
          <ReviewRow label="Phone" value={cadet.phone} light />
          <ReviewRow label="Theme" value={theme === "dark" ? "Dark mode" : "Light mode"} light />
        </div>
        <div className="mt-5 space-y-2">
          {settings.map(([label, Icon]) => (
            <button type="button" key={label} className="flex w-full items-center justify-between rounded-[22px] bg-slate-100 p-4 text-left font-black">
              <span className="flex items-center gap-3"><Icon className="h-5 w-5 text-teal-800" /> {label}</span>
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </button>
          ))}
        </div>
      </div>
    </SheetFrame>
  );
}

function LeaveDetailSheet({ leave, onClose }: { leave: LeaveRecord; onClose: () => void }) {
  const timeline = ["Submitted", "Under Review", leave.status === "rejected" ? "Rejected" : "Approved", "Gate Checkout", "Leave Active", "Gate Check-in", "Completed"];
  const activeIndex = leave.status === "pending" ? 1 : leave.status === "approved" ? 2 : leave.status === "active" ? 4 : leave.status === "completed" ? 6 : 2;
  return (
    <SheetFrame onClose={onClose}>
      <div className="rounded-[32px] bg-white p-5 text-slate-950">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-teal-800/55">{leave.id}</p>
            <h2 className="mt-2 text-3xl font-black">{leave.type}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">{leave.destination}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100" aria-label="Close leave details">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5 grid gap-2">
          <ReviewRow label="Departure" value={leave.departure} light />
          <ReviewRow label="Return" value={leave.returnAt} light />
          <ReviewRow label="Reason" value={leave.reason} light />
          <ReviewRow label="Documents" value={leave.documents.join(", ") || "No documents"} light />
        </div>
        <div className="mt-5 rounded-[26px] bg-slate-100 p-4">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Movement timeline</p>
          <div className="mt-4 space-y-3">
            {timeline.map((item, index) => (
              <div key={item} className="flex items-center gap-3">
                <span className={`grid h-8 w-8 place-items-center rounded-full ${index <= activeIndex ? "bg-slate-950 text-cyan-100" : "bg-white text-slate-400"}`}>
                  {index <= activeIndex ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                <span className={`font-bold ${index <= activeIndex ? "text-slate-950" : "text-slate-400"}`}>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SheetFrame>
  );
}

function SuccessSheet({ onClose }: { onClose: () => void }) {
  return (
    <SheetFrame onClose={onClose}>
      <div className="rounded-[32px] bg-[#041113] p-6 text-center text-white ring-1 ring-white/12">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }} className="mx-auto grid h-20 w-20 place-items-center rounded-[30px] bg-cyan-200 text-slate-950 shadow-2xl shadow-cyan-900/30">
          <CheckCircle2 className="h-10 w-10" />
        </motion.div>
        <h2 className="mt-5 text-3xl font-black">Leave Request Submitted</h2>
        <p className="mt-2 text-white/62">Request ID SL-2026-NEW is now pending review.</p>
        <button type="button" onClick={onClose} className="mt-6 min-h-13 w-full rounded-[22px] bg-cyan-200 font-black text-slate-950">Done</button>
      </div>
    </SheetFrame>
  );
}

function BottomNav({ tab, setTab }: { tab: TabKey; setTab: (tab: TabKey) => void }) {
  const nav = [
    ["home", "Home", Home],
    ["apply", "Apply", Plus],
    ["leaves", "Leaves", FileCheck2],
    ["gate", "Pass", IdCard],
    ["notifications", "Alerts", Bell],
  ] as const;
  return (
    <nav className="absolute inset-x-0 bottom-0 z-30 px-4 pb-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
      <div className="grid grid-cols-5 gap-1 rounded-[28px] bg-[#041113]/86 p-2 shadow-2xl ring-1 ring-white/12 backdrop-blur-2xl">
        {nav.map(([key, label, Icon]) => {
          const active = tab === key;
          return (
            <button key={key} type="button" onClick={() => setTab(key)} className={`relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-[22px] text-[10px] font-black transition ${active ? "bg-cyan-200 text-slate-950" : "text-white/55"}`}>
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function ScreenHero({ eyebrow, title, body, icon: Icon }: { eyebrow: string; title: string; body: string; icon: typeof IdCard }) {
  return (
    <div className="rounded-[32px] bg-[#041113] p-5 shadow-2xl ring-1 ring-white/12">
      <div className="grid h-13 w-13 place-items-center rounded-[22px] bg-cyan-200 text-slate-950">
        <Icon className="h-6 w-6" />
      </div>
      <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-100/55">{eyebrow}</p>
      <h2 className="mt-2 text-4xl font-black leading-none tracking-tight">{title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-white/58">{body}</p>
    </div>
  );
}

function SectionTitle({ eyebrow, title, compact }: { eyebrow: string; title: string; compact?: boolean }) {
  return (
    <div className={compact ? "" : "mb-3"}>
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-100/50">{eyebrow}</p>
      <h3 className="mt-1 text-xl font-black tracking-tight text-white">{title}</h3>
    </div>
  );
}

function StepHeader({ icon: Icon, title, body }: { icon: typeof Compass; title: string; body: string }) {
  return (
    <div>
      <div className="grid h-12 w-12 place-items-center rounded-[20px] bg-cyan-200 text-slate-950">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-2xl font-black">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-white/58">{body}</p>
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block rounded-[24px] bg-white/8 p-4 ring-1 ring-white/12">
      <span className="text-[11px] font-black uppercase tracking-[0.18em] text-white/45">{label}</span>
      <input type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full bg-transparent text-base font-black text-white outline-none [color-scheme:dark]" />
    </label>
  );
}

function TextField({ label, value, onChange, icon: Icon }: { label: string; value: string; onChange: (value: string) => void; icon: typeof Navigation }) {
  return (
    <label className="flex items-center gap-3 rounded-[24px] bg-white/8 p-4 ring-1 ring-white/12">
      <Icon className="h-5 w-5 text-cyan-100" />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-black uppercase tracking-[0.18em] text-white/45">{label}</span>
        <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full bg-transparent text-base font-black text-white outline-none placeholder:text-white/35" />
      </span>
    </label>
  );
}

function ReviewRow({ label, value, light }: { label: string; value: string; light?: boolean }) {
  return (
    <div className={`rounded-[20px] p-3 ${light ? "bg-slate-100" : "bg-white/8 ring-1 ring-white/10"}`}>
      <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${light ? "text-slate-500" : "text-white/42"}`}>{label}</p>
      <p className={`mt-1 text-sm font-black ${light ? "text-slate-950" : "text-white"}`}>{value}</p>
    </div>
  );
}

function PassField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] bg-slate-100 p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-black">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: LeaveStatus }) {
  const style = statusStyles[status];
  return (
    <span className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] ${status === "approved" || status === "active" ? "bg-cyan-200 text-slate-950" : status === "rejected" ? "bg-rose-300 text-rose-950" : "bg-white/10 text-white/70"}`}>
      {style.label}
    </span>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="grid h-11 w-11 place-items-center rounded-[18px] bg-white/12 text-white ring-1 ring-white/15 backdrop-blur-xl" aria-label={label}>
      {children}
    </button>
  );
}

function SheetFrame({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <motion.div className="fixed inset-0 z-50 grid items-end bg-black/55 p-3 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div initial={{ y: 48, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 36, opacity: 0, scale: 0.98 }} transition={{ type: "spring", stiffness: 260, damping: 26 }} onClick={(event) => event.stopPropagation()} className="mx-auto w-full max-w-md">
        {children}
      </motion.div>
    </motion.div>
  );
}
