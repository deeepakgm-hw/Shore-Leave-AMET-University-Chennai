import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, AnimatePresence, useScroll, useTransform, useSpring } from "framer-motion";
import { Layers, ShieldCheck, ScanFace, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import heroImage from "@/assets/hero-maritime.jpg";
import { ScrollReelTestimonials } from "@/components/ScrollReelTestimonials";
import teamTarun from "@/assets/team-tarun.jpg";
import teamDarshan from "@/assets/team-darshan.jpg";
import teamDeepak from "@/assets/team-deepak.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Shore Leave — Simple shore leave management for AMET" },
      { name: "description", content: "Fully managed face verification and emergency gate-pass platform for AMET cadets, administrators, and campus movement." },
      { property: "og:title", content: "Shore Leave" },
      { property: "og:description", content: "Fully managed face verification and emergency gate-pass platform for AMET." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const [teamOpen, setTeamOpen] = useState(false);
  const { scrollY } = useScroll();
  // Smooth parallax: gentle drift + micro zoom, spring-damped to feel premium
  const smoothScroll = useSpring(scrollY, { stiffness: 80, damping: 22, mass: 0.4 });
  const bgY = useTransform(smoothScroll, [0, 1600], [0, 140]);
  const bgScale = useTransform(smoothScroll, [0, 1600], [1, 1.04]);
  const highlightY = useTransform(smoothScroll, [0, 1600], [0, 60]);
  const highlightOpacity = useTransform(smoothScroll, [0, 800], [1, 0.85]);
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <SkyScene />
      {/* Full-screen maritime background */}
      <motion.div
        initial={false}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.6, ease: "easeOut" }}
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${heroImage})`, y: bgY, scale: bgScale, willChange: "transform" }}
      />
      {/* Soft center highlight so text reads */}
      <motion.div
        style={{ y: highlightY, opacity: highlightOpacity, willChange: "transform, opacity" }}
        className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_55%_45%_at_50%_40%,oklch(1_0_0/0.75),transparent_75%)]"
      />

      {/* Header */}
      <header className="relative z-20 mx-auto flex max-w-7xl items-center justify-between px-6 py-6 sm:px-8">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent">
            <Layers className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="text-base font-semibold tracking-tight">Shore Leave</span>
        </div>
        <nav className="inline-flex items-center rounded-full border border-border/60 bg-card/50 p-1 text-sm backdrop-blur">
          <Link
            to="/checkin"
            className="rounded-full px-4 py-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Check-in
          </Link>
          <span aria-hidden className="h-4 w-px bg-border/70" />
          <Link
            to="/checkout"
            className="rounded-full px-4 py-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Check-out
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative">
        <div className="relative mx-auto max-w-7xl px-6 pb-32 pt-16 text-center sm:px-8 sm:pt-24">
          {/* Icon row */}
          <motion.div
            initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
            className="mx-auto mb-12 flex max-w-md items-center justify-center gap-0"
          >
            <IconBubble icon={Layers} />
            <Dash />
            <IconBubble icon={ScanFace} highlight />
            <Dash />
            <IconBubble icon={ShieldCheck} />
          </motion.div>

          <motion.h1
            initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1 }}
            className="mx-auto max-w-4xl text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl"
          >
            <AnimatedWords text="The simple way to" />
            <br />
            <AnimatedWords text="manage" delay={0.5} />{" "}
            <motion.span
              initial={false}
              animate={{ opacity: 1, backgroundSize: "100% 100%" }}
              transition={{ duration: 1.2, delay: 1.0, ease: "easeOut" }}
              className="text-gradient inline-block"
            >
              shore leave
            </motion.span>
          </motion.h1>

          <motion.p
            initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 1.3 }}
            className="mx-auto mt-6 max-w-xl text-base text-muted-foreground sm:text-lg"
          >
            Fully managed face verification and emergency gate-pass platform for AMET cadets, administrators, and campus movement.
          </motion.p>

          <motion.div
            initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 1.6 }}
            className="mt-10 flex flex-wrap items-center justify-center gap-3"
          >
            <Link to="/auth" search={{ role: "cadet" }} className="group inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background transition-transform hover:scale-[1.03]">
              Login as Cadet
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link to="/auth" search={{ role: "admin" }} className="inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-6 py-3 text-sm font-semibold backdrop-blur transition-colors hover:border-primary/40">
              Login as Administrator
            </Link>
          </motion.div>

          {/* Feature row */}
          <div className="mt-32 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div key={f.title}
                initial={false} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className="rounded-2xl border border-border bg-card/40 p-6 text-left backdrop-blur-md"
              >
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary"><f.icon className="h-5 w-5" /></div>
                <h3 className="mt-5 text-base font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <footer className="relative border-t border-border py-8 text-center text-xs text-muted-foreground">
        <div>© {new Date().getFullYear()} Shore Leave · AMET campus operations</div>
        <button
          type="button"
          onClick={() => setTeamOpen(true)}
          className="mt-2 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Developed by team <span className="text-gradient font-semibold">"Find It"</span>
        </button>
      </footer>

      <TeamDialog open={teamOpen} onClose={() => setTeamOpen(false)} />
    </div>
  );
}

function TeamDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-[1060px]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onClose}
              className="absolute -top-3 -right-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-foreground text-background shadow-lg hover:scale-105 transition-transform"
              aria-label="Close"
            >
              ✕
            </button>
            <ScrollReelTestimonials testimonials={TEAM} charStaggerMs={8} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const TEAM = [
  {
    quote: "Designing the calm surface — every pixel of Shore Leave passes through his hands.",
    author: "Tarun · UI/UX Developer",
    image: teamTarun,
  },
  {
    quote: "Wiring the gates, the cameras, the passes — nothing ships without his verification loop.",
    author: "Darshan · Coder",
    image: teamDarshan,
  },
  {
    quote: "Bringing the interface to life — motion, code, and the quiet frames between every scan.",
    author: "Deepak · Coder & Animation",
    image: teamDeepak,
  },
];

const FEATURES = [
  { icon: ScanFace, title: "Face verification", desc: "Biometric enrollment that recognizes cadets at the gate in under a second." },
  { icon: Layers, title: "Emergency gate passes", desc: "PDF gate passes with fingerprint-first verification and emergency codes for manual gate checks." },
  { icon: ShieldCheck, title: "Audit-ready logs", desc: "Every entry, exit, and approval recorded with cryptographic timestamps." },
];

function IconBubble({ icon: Icon, highlight }: { icon: LucideIcon; highlight?: boolean }) {
  return (
    <div className={`grid h-14 w-14 place-items-center rounded-full border ${highlight ? "border-primary/40 bg-card shadow-[0_0_30px_oklch(0.72_0.18_45/0.35)]" : "border-border bg-card/60"} backdrop-blur`}>
      <Icon className={`h-5 w-5 ${highlight ? "text-primary" : "text-muted-foreground"}`} />
    </div>
  );
}
function Dash() {
  return <div className="h-px w-12 bg-gradient-to-r from-transparent via-border to-transparent sm:w-20" />;
}

/* ---------- Ambient animated scene: birds + ships ---------- */

function SkyScene() {
  const birds = [
    { top: "8%", delay: 0, dur: 32, scale: 1 },
    { top: "14%", delay: 6, dur: 40, scale: 0.7 },
    { top: "22%", delay: 2, dur: 28, scale: 0.85 },
    { top: "5%", delay: 14, dur: 46, scale: 0.6 },
    { top: "30%", delay: 10, dur: 36, scale: 0.75 },
    { top: "60%", delay: 18, dur: 50, scale: 0.65 },
    { top: "72%", delay: 4, dur: 42, scale: 0.8 },
    { top: "85%", delay: 22, dur: 55, scale: 0.7 },
  ];
  const ships = [
    { top: "62%", delay: 0, dur: 90, scale: 1, opacity: 0.55 },
    { top: "78%", delay: 30, dur: 120, scale: 0.7, opacity: 0.4 },
    { top: "88%", delay: 60, dur: 150, scale: 1.2, opacity: 0.35 },
  ];
  return (
    <div className="pointer-events-none fixed inset-0 z-[1] overflow-hidden">
      {birds.map((b, i) => (
        <motion.div
          key={`b-${i}`}
          initial={{ x: "-10vw" }}
          animate={{ x: "110vw" }}
          transition={{ duration: b.dur, delay: b.delay, repeat: Infinity, ease: "linear" }}
          style={{ top: b.top, transform: `scale(${b.scale})` }}
          className="absolute left-0"
        >
          <Bird />
        </motion.div>
      ))}
      {ships.map((s, i) => (
        <motion.div
          key={`s-${i}`}
          initial={{ x: "-25vw" }}
          animate={{ x: "115vw" }}
          transition={{ duration: s.dur, delay: s.delay, repeat: Infinity, ease: "linear" }}
          style={{ top: s.top, opacity: s.opacity, transform: `scale(${s.scale})` }}
          className="absolute left-0"
        >
          <Ship />
        </motion.div>
      ))}
    </div>
  );
}

function Bird() {
  return (
    <motion.svg
      width="34" height="18" viewBox="0 0 34 18" fill="none"
      animate={{ y: [0, -4, 0, 3, 0] }}
      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      className="text-foreground/40"
    >
      <motion.path
        d="M2 10 Q 8 2, 14 10 Q 17 6, 20 10 Q 26 2, 32 10"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"
        animate={{ d: [
          "M2 10 Q 8 2, 14 10 Q 17 6, 20 10 Q 26 2, 32 10",
          "M2 8 Q 8 12, 14 8 Q 17 10, 20 8 Q 26 12, 32 8",
          "M2 10 Q 8 2, 14 10 Q 17 6, 20 10 Q 26 2, 32 10",
        ]}}
        transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
      />
    </motion.svg>
  );
}

function Ship() {
  return (
    <motion.svg
      width="120" height="60" viewBox="0 0 120 60" fill="none"
      animate={{ y: [0, -2, 0, 2, 0] }}
      transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      className="text-foreground/60 drop-shadow-sm"
    >
      {/* masts */}
      <line x1="40" y1="38" x2="40" y2="8" stroke="currentColor" strokeWidth="1" />
      <line x1="70" y1="38" x2="70" y2="4" stroke="currentColor" strokeWidth="1" />
      <line x1="95" y1="38" x2="95" y2="10" stroke="currentColor" strokeWidth="1" />
      {/* sails */}
      <path d="M40 10 L58 36 L40 36 Z" fill="currentColor" opacity="0.35" />
      <path d="M70 6 L92 38 L70 38 Z" fill="currentColor" opacity="0.4" />
      <path d="M95 12 L112 38 L95 38 Z" fill="currentColor" opacity="0.3" />
      {/* hull */}
      <path d="M20 40 L108 40 L100 52 L28 52 Z" fill="currentColor" opacity="0.75" />
    </motion.svg>
  );
}

function AnimatedWords({ text, delay = 0 }: { text: string; delay?: number }) {
  const words = text.split(" ");
  return (
    <span className="inline-block">
      {words.map((word, i) => (
        <span key={i} className="inline-block overflow-hidden pb-2 align-bottom">
          <motion.span
            initial={false}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.7, delay: delay + i * 0.09, ease: [0.22, 1, 0.36, 1] }}
            className="inline-block"
          >
            {word}
          </motion.span>
          {i < words.length - 1 && <span>&nbsp;</span>}
        </span>
      ))}
    </span>
  );
}
