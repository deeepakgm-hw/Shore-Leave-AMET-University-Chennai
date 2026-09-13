import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, CheckCircle2, Fingerprint, KeyRound, Loader2, Mail, XCircle } from "lucide-react";
import { apiRequest } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import { getErrorMessage } from "@/lib/errors";

type Mode = "checkin" | "checkout";
type Method = "fingerprint" | "email_otp";
type Flash = { kind: "granted" | "denied"; text: string; sub?: string } | null;

const COOLDOWN_MS = 5000;
const RESET_MS = 4200;

function directionForMode(mode: Mode) {
  return mode === "checkin" ? "CHECK_IN" : "CHECK_OUT";
}

function terminalName(mode: Mode) {
  return mode === "checkin" ? "Gate Terminal Check-In" : "Gate Terminal Check-Out";
}

export default function GateTerminal({ mode }: { mode: Mode }) {
  const [method, setMethod] = useState<Method>("fingerprint");
  const [identity, setIdentity] = useState("");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [pendingOtp, setPendingOtp] = useState<{ sessionToken: string; email: string; expiresAt?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [deviceStatus, setDeviceStatus] = useState("Checking scanner");
  const lastRef = useRef<{ key: string; at: number } | null>(null);
  const identityRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const direction = directionForMode(mode);
  const isCheckIn = mode === "checkin";
  const title = isCheckIn ? "CHECK-IN" : "CHECK-OUT";
  const headline = isCheckIn ? "Welcome Back" : "Ready for Departure";
  const prompt = isCheckIn
    ? "Place your enrolled finger on the scanner to record your return."
    : "Place your enrolled finger on the scanner to verify your identity and check out.";
  const processingTitle = isCheckIn ? "Verifying Return" : "Verifying Fingerprint";
  const successTitle = isCheckIn ? "Check-In Successful" : "Check-Out Successful";
  const successBody = isCheckIn ? "Your return has been recorded successfully. Welcome back to campus." : "Your shore leave has been activated.";
  const accent = isCheckIn ? "from-emerald-500 to-teal-600" : "from-indigo-500 to-blue-600";

  useEffect(() => {
    apiRequest<{ connected?: boolean; deviceModel?: string }>(endpoints.fingerprint.deviceStatus)
      .then((status) => setDeviceStatus(status.connected ? `${status.deviceModel || "Fingerprint scanner"} online` : "Fingerprint Scanner Offline"))
      .catch(() => setDeviceStatus("Fingerprint Scanner Offline"));
  }, []);

  useEffect(() => {
    if (method === "fingerprint") identityRef.current?.focus();
    if (method === "email_otp") emailRef.current?.focus();
  }, [method, flash]);

  function resetSoon() {
    window.setTimeout(() => {
      setFlash(null);
      setOtpCode("");
      setPendingOtp(null);
      setBusy(false);
    }, RESET_MS);
  }

  function guardDuplicate(key: string): boolean {
    const now = Date.now();
    if (lastRef.current && lastRef.current.key === key && now - lastRef.current.at < COOLDOWN_MS) {
      setFlash({ kind: "denied", text: "Duplicate Verification", sub: "Wait a few seconds and try again." });
      resetSoon();
      return false;
    }
    lastRef.current = { key, at: now };
    return true;
  }

  function showGateSuccess(gate: any, fallbackName?: string) {
    const cadetName = gate?.cadet?.name || gate?.cadetName || fallbackName || "Identity confirmed";
    const time = isCheckIn ? gate?.timeIn : gate?.timeOut;
    setFlash({
      kind: "granted",
      text: successTitle,
      sub: `${successBody}${time ? ` Recorded at ${time}.` : ""} ${cadetName}`,
    });
  }

  async function verifyFingerprint(event: React.FormEvent) {
    event.preventDefault();
    const key = `fingerprint:${direction}:${identity.trim() || "identify"}`;
    if (busy || !guardDuplicate(key)) return;
    setBusy(true);
    try {
      const result = await apiRequest<any>(endpoints.fingerprint.verify, {
        method: "POST",
        body: JSON.stringify({
          cadetId: identity.trim() || undefined,
          direction,
          terminal: terminalName(mode),
        }),
      });
      if (!result?.success) throw new Error(result?.message || "Fingerprint Not Recognized");
      showGateSuccess(result.gate || result, result.cadet?.name);
    } catch (error: unknown) {
      setFlash({
        kind: "denied",
        text: "Fingerprint Not Recognized",
        sub: getErrorMessage(error, "We couldn't verify your fingerprint. Please try again or use email verification."),
      });
    } finally {
      resetSoon();
    }
  }

  async function requestOtp(event: React.FormEvent) {
    event.preventDefault();
    const cadetEmail = email.trim().toLowerCase();
    if (!cadetEmail || busy || !guardDuplicate(`otp:${direction}:${cadetEmail}`)) return;
    setBusy(true);
    try {
      const response = await apiRequest<{ sessionToken: string; expiresAt?: string }>(endpoints.gate.generateOtp, {
        method: "POST",
        body: JSON.stringify({ email: cadetEmail, purpose: direction, terminal: terminalName(mode) }),
      });
      setPendingOtp({ sessionToken: response.sessionToken, email: cadetEmail, expiresAt: response.expiresAt });
      setBusy(false);
    } catch (error: unknown) {
      setFlash({ kind: "denied", text: "Email Verification Failed", sub: getErrorMessage(error, "Cadet email could not be verified.") });
      resetSoon();
    }
  }

  async function verifyOtp(event: React.FormEvent) {
    event.preventDefault();
    if (!pendingOtp || otpCode.length !== 6 || busy) return;
    setBusy(true);
    try {
      const response = await apiRequest<any>(endpoints.gate.verifyOtp, {
        method: "POST",
        body: JSON.stringify({
          sessionToken: pendingOtp.sessionToken,
          email: pendingOtp.email,
          otp: otpCode,
          purpose: direction,
          terminal: terminalName(mode),
        }),
      });
      showGateSuccess(response.gate, response.cadet?.name);
    } catch (error: unknown) {
      setFlash({ kind: "denied", text: "Invalid or Expired Code", sub: getErrorMessage(error, "Please request a new verification code.") });
    } finally {
      resetSoon();
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-gradient-to-br from-background via-background to-muted/40">
      <header className="flex items-center justify-between px-6 py-5">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Landing
        </Link>
        <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Gate Terminal · {new Date().toLocaleDateString()}</div>
        <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground">Admin</Link>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6">
        <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`bg-gradient-to-r ${accent} bg-clip-text text-6xl font-black tracking-tight text-transparent sm:text-7xl`}>
          {title}
        </motion.h1>
        <p className="mt-3 text-sm uppercase tracking-[0.3em] text-muted-foreground">{headline}</p>

        <div className="mt-8 inline-flex rounded-full border border-border bg-card/70 p-1 backdrop-blur">
          {([
            ["fingerprint", "Fingerprint", Fingerprint],
            ["email_otp", "Email + OTP", Mail],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => { setMethod(key); setFlash(null); setPendingOtp(null); }}
              className={`inline-flex items-center gap-2 rounded-full px-6 py-2 text-sm font-semibold transition-colors ${method === key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="mt-10 w-full max-w-md">
          <AnimatePresence mode="wait">
            {flash ? (
              <motion.div key="flash" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} className={`rounded-3xl border p-8 text-center shadow-xl ${flash.kind === "granted" ? "border-emerald-500/40 bg-emerald-500/10" : "border-red-500/40 bg-red-500/10"}`}>
                {flash.kind === "granted" ? <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" /> : <XCircle className="mx-auto h-14 w-14 text-red-500" />}
                <div className={`mt-4 text-2xl font-bold ${flash.kind === "granted" ? "text-emerald-600" : "text-red-600"}`}>{flash.text}</div>
                {flash.sub && <div className="mt-2 text-sm text-muted-foreground">{flash.sub}</div>}
                <div className="mt-6 text-[11px] uppercase tracking-widest text-muted-foreground">Resetting</div>
              </motion.div>
            ) : method === "fingerprint" ? (
              <motion.form key="fingerprint" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} onSubmit={verifyFingerprint} className="rounded-3xl border border-border bg-card/70 p-8 shadow-xl backdrop-blur">
                <div className="flex flex-col items-center text-center">
                  <div className="relative flex h-44 w-44 items-center justify-center">
                    <motion.span className={`absolute inset-0 rounded-full bg-gradient-to-br ${accent} opacity-30`} animate={{ scale: [1, 1.35, 1], opacity: [0.35, 0, 0.35] }} transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }} />
                    <div className={`relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br ${accent} shadow-2xl`}>
                      {busy ? <Loader2 className="h-12 w-12 animate-spin text-white" /> : <Fingerprint className="h-12 w-12 text-white" />}
                    </div>
                  </div>
                  <div className="mt-4 text-lg font-semibold tracking-tight">{busy ? processingTitle : "Fingerprint Verification"}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{busy ? "Please keep your finger on the scanner." : prompt}</div>
                  <div className="mt-3 rounded-full border border-border bg-background/60 px-3 py-1 text-xs text-muted-foreground">{deviceStatus}</div>
                </div>

                <label className="mt-6 block text-xs uppercase tracking-widest text-muted-foreground">Cadet email / roll</label>
                <input ref={identityRef} value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="Optional if scanner supports identification" className="mt-3 w-full rounded-2xl border border-border bg-background px-5 py-3 text-center text-sm outline-none focus:border-foreground" />
                <button type="submit" disabled={busy} className="mt-5 w-full rounded-full bg-foreground py-3 text-sm font-semibold text-background disabled:opacity-50">
                  {busy ? "Scanning Fingerprint" : isCheckIn ? "Verify Return" : "Verify & Check Out"}
                </button>
              </motion.form>
            ) : (
              <motion.div key="otp" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-border bg-card/70 p-8 shadow-xl backdrop-blur">
                {!pendingOtp ? (
                  <form onSubmit={requestOtp}>
                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-foreground text-background"><Mail className="h-6 w-6" /></div>
                    <h2 className="mt-5 text-center text-xl font-bold">Email Verification</h2>
                    <p className="mt-2 text-center text-sm text-muted-foreground">Enter the registered email address to continue.</p>
                    <label className="mt-6 block text-xs uppercase tracking-widest text-muted-foreground">Cadet Email</label>
                    <input ref={emailRef} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cadet@amet.edu" className="mt-3 w-full rounded-2xl border border-border bg-background px-5 py-4 text-center text-base outline-none focus:border-foreground" />
                    <button type="submit" disabled={busy || !email.trim()} className="mt-5 w-full rounded-full bg-foreground py-3 text-sm font-semibold text-background disabled:opacity-50">
                      {busy ? "Sending OTP" : "Send OTP"}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={verifyOtp}>
                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-foreground text-background"><KeyRound className="h-6 w-6" /></div>
                    <h2 className="mt-5 text-center text-xl font-bold">Enter Verification Code</h2>
                    <p className="mt-2 text-center text-sm text-muted-foreground">We sent a verification code to your registered email.</p>
                    <input autoFocus inputMode="numeric" value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-6 w-full rounded-2xl border border-border bg-background px-5 py-4 text-center text-2xl font-mono tracking-[0.5em] outline-none focus:border-foreground" />
                    <button type="submit" disabled={busy || otpCode.length !== 6} className="mt-5 w-full rounded-full bg-foreground py-3 text-sm font-semibold text-background disabled:opacity-50">
                      {busy ? "Verifying" : "Verify & Continue"}
                    </button>
                  </form>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
