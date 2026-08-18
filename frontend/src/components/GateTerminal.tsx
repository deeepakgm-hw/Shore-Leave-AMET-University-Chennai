import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, CheckCircle2, XCircle, Wifi, KeyRound, ChevronDown } from "lucide-react";
import {
  nfcCheckIn,
  nfcCheckOut,
  lookupCadetByRoll,
} from "@/lib/gate.functions";
import { getErrorMessage } from "@/lib/errors";
import { apiRequest } from "@/api/client";
import { endpoints } from "@/api/endpoints";

type Mode = "checkin" | "checkout";
type Method = "nfc" | "otp";
type Flash = { kind: "granted" | "denied"; text: string; sub?: string } | null;

const COOLDOWN_MS = 5000;
const RESET_MS = 2800;

export default function GateTerminal({ mode }: { mode: Mode }) {
  const [method, setMethod] = useState<Method>("nfc");
  const [uid, setUid] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [roll, setRoll] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [pendingOtp, setPendingOtp] = useState<{ sessionToken: string; roll: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const lastRef = useRef<{ key: string; at: number } | null>(null);
  const nfcRef = useRef<HTMLInputElement>(null);
  const rollRef = useRef<HTMLInputElement>(null);

  const doCheckIn = nfcCheckIn;
  const doCheckOut = nfcCheckOut;
  const lookup = lookupCadetByRoll;

  const title = mode === "checkin" ? "CHECK-IN" : "CHECK-OUT";
  const accent = mode === "checkin" ? "from-emerald-500 to-teal-600" : "from-indigo-500 to-blue-600";

  useEffect(() => {
    if (method === "nfc" && showManual) nfcRef.current?.focus();
    else if (method === "otp") rollRef.current?.focus();
  }, [method, flash, showManual]);

  function resetSoon() {
    setTimeout(() => {
      setFlash(null);
      setUid("");
      setRoll("");
      setOtpCode("");
      setPendingOtp(null);
      setBusy(false);
    }, RESET_MS);
  }

  function guardDuplicate(key: string): boolean {
    const now = Date.now();
    if (lastRef.current && lastRef.current.key === key && now - lastRef.current.at < COOLDOWN_MS) {
      setFlash({ kind: "denied", text: "DUPLICATE SCAN", sub: "Wait a few seconds and try again" });
      resetSoon();
      return false;
    }
    lastRef.current = { key, at: now };
    return true;
  }

  async function performGate(nfcUid: string, viaOtp = false) {
    if (!guardDuplicate(nfcUid)) return;
    setBusy(true);
    try {
      if (mode === "checkin") {
        const res = await doCheckIn({ data: { nfcUid, device: viaOtp ? "gate-terminal-otp" : "gate-terminal" } });
        setFlash({
          kind: "granted",
          text: res.late ? "LATE RETURN — ACCESS GRANTED" : "ACCESS GRANTED",
          sub: res.cadet?.name,
        });
      } else {
        const res = await doCheckOut({
          data: { nfcUid, device: viaOtp ? "gate-terminal-otp" : "gate-terminal" },
        });
        setFlash({ kind: "granted", text: "ACCESS GRANTED", sub: res.cadet?.name });
      }
    } catch (error: unknown) {
      setFlash({ kind: "denied", text: "ACCESS DENIED", sub: getErrorMessage(error) });
    } finally {
      resetSoon();
    }
  }

  async function onNfcSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = uid.trim();
    if (!v || busy) return;
    await performGate(v);
  }

  async function onOtpStart(e: React.FormEvent) {
    e.preventDefault();
    const r = roll.trim();
    if (!r || busy) return;
    setBusy(true);
    try {
      await lookup({ data: { roll: r } });
      const response = await apiRequest<{ sessionToken: string }>(endpoints.gate.generateOtp, {
        method: "POST",
        body: JSON.stringify({ roll: r, purpose: mode === "checkin" ? "CHECK_IN" : "CHECK_OUT" }),
      });
      setPendingOtp({ sessionToken: response.sessionToken, roll: r });
      setBusy(false);
    } catch (error: unknown) {
      setFlash({ kind: "denied", text: "LOOKUP FAILED", sub: getErrorMessage(error) });
      resetSoon();
    }
  }

  async function onOtpVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingOtp || busy) return;
    setBusy(true);
    try {
      await apiRequest(endpoints.gate.verifyOtp, {
        method: "POST",
        body: JSON.stringify({ sessionToken: pendingOtp.sessionToken, roll: pendingOtp.roll, otp: otpCode, purpose: mode === "checkin" ? "CHECK_IN" : "CHECK_OUT" }),
      });
      setFlash({ kind: "granted", text: "OTP VERIFIED", sub: `${pendingOtp.roll} is cleared for ${title.toLowerCase()}` });
    } catch (error) {
      setFlash({ kind: "denied", text: "INVALID OR EXPIRED OTP", sub: getErrorMessage(error) });
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
        <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground">Admin →</Link>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6">
        <motion.h1
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className={`bg-gradient-to-r ${accent} bg-clip-text text-6xl font-black tracking-tight text-transparent sm:text-7xl`}
        >
          {title}
        </motion.h1>
        <p className="mt-3 text-sm uppercase tracking-[0.3em] text-muted-foreground">Choose Verification Method</p>

        <div className="mt-8 inline-flex rounded-full border border-border bg-card/70 p-1 backdrop-blur">
          {(["nfc", "otp"] as Method[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMethod(m); setFlash(null); setPendingOtp(null); }}
              className={`inline-flex items-center gap-2 rounded-full px-6 py-2 text-sm font-semibold transition-colors ${
                method === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "nfc" ? <Wifi className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
              {m.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="mt-10 w-full max-w-md">
          <AnimatePresence mode="wait">
            {flash ? (
              <motion.div
                key="flash"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className={`rounded-3xl border p-8 text-center shadow-xl ${
                  flash.kind === "granted"
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-red-500/40 bg-red-500/10"
                }`}
              >
                {flash.kind === "granted" ? (
                  <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
                ) : (
                  <XCircle className="mx-auto h-14 w-14 text-red-500" />
                )}
                <div className={`mt-4 text-2xl font-bold ${flash.kind === "granted" ? "text-emerald-600" : "text-red-600"}`}>
                  {flash.text}
                </div>
                {flash.sub && <div className="mt-2 text-sm text-muted-foreground">{flash.sub}</div>}
                <div className="mt-6 text-[11px] uppercase tracking-widest text-muted-foreground">Resetting…</div>
              </motion.div>
            ) : method === "nfc" ? (
              <motion.form
                key="nfc"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                onSubmit={onNfcSubmit}
                className="rounded-3xl border border-border bg-card/70 p-8 shadow-xl backdrop-blur"
              >
                <div className="flex flex-col items-center">
                  {/* Scanning animation */}
                  <div className="relative flex h-44 w-44 items-center justify-center">
                    {/* Pulse rings */}
                    <motion.span
                      className={`absolute inset-0 rounded-full bg-gradient-to-br ${accent} opacity-30`}
                      animate={{ scale: [1, 1.35, 1], opacity: [0.35, 0, 0.35] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                    />
                    <motion.span
                      className={`absolute inset-4 rounded-full bg-gradient-to-br ${accent} opacity-40`}
                      animate={{ scale: [1, 1.25, 1], opacity: [0.4, 0.05, 0.4] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 0.4 }}
                    />
                    {/* Card face */}
                    <div className={`relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br ${accent} shadow-2xl`}>
                      <Wifi className="h-12 w-12 rotate-90 text-white" />
                      {/* Scan line */}
                      <motion.span
                        className="absolute left-2 right-2 h-[2px] rounded bg-white/80"
                        animate={{ top: ["18%", "82%", "18%"] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                      />
                    </div>
                  </div>
                  <div className="mt-4 text-center">
                    <div className="text-lg font-semibold tracking-tight">
                      {busy ? "Verifying…" : "Waiting for NFC tap"}
                    </div>
                    <div className="mt-1 text-xs uppercase tracking-[0.3em] text-muted-foreground">
                      Hold card near the reader
                    </div>
                  </div>
                </div>

                {/* Optional manual UID */}
                <div className="mt-6 border-t border-border/60 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowManual((s) => !s)}
                    className="mx-auto flex items-center gap-1 text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
                  >
                    <ChevronDown className={`h-3 w-3 transition-transform ${showManual ? "rotate-180" : ""}`} />
                    {showManual ? "Hide manual entry" : "Enter UID manually (optional)"}
                  </button>
                  <AnimatePresence>
                    {showManual && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <input
                          ref={nfcRef}
                          value={uid}
                          onChange={(e) => setUid(e.target.value)}
                          placeholder="NFC-XXXXXX"
                          className="mt-3 w-full rounded-2xl border border-border bg-background px-5 py-3 text-center font-mono text-lg tracking-widest outline-none focus:border-foreground"
                        />
                        <button
                          type="submit"
                          disabled={busy || !uid.trim()}
                          className="mt-3 w-full rounded-full bg-foreground py-2.5 text-sm font-semibold text-background disabled:opacity-50"
                        >
                          {busy ? "Verifying…" : `Confirm ${title}`}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.form>
            ) : (
              <motion.div key="otp" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-border bg-card/70 p-8 shadow-xl backdrop-blur">
                {!pendingOtp ? (
                  <form onSubmit={onOtpStart}>
                    <label className="block text-xs uppercase tracking-widest text-muted-foreground">Enter Roll Number</label>
                    <input
                      ref={rollRef}
                      value={roll}
                      onChange={(e) => setRoll(e.target.value)}
                      placeholder="e.g. NAV-001"
                      className="mt-3 w-full rounded-2xl border border-border bg-background px-5 py-4 text-center text-xl font-mono tracking-widest outline-none focus:border-foreground"
                    />
                    <button type="submit" disabled={busy || !roll.trim()} className="mt-5 w-full rounded-full bg-foreground py-3 text-sm font-semibold text-background disabled:opacity-50">
                      {busy ? "Looking up…" : "Generate OTP"}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={onOtpVerify}>
                    <div className="rounded-2xl border border-dashed border-border bg-background/50 p-4 text-center">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">One-time code for {pendingOtp.roll}</div>
                      <div className="mt-1 text-sm font-semibold">Code sent to the cadet's registered email</div>
                    </div>
                    <label className="mt-5 block text-xs uppercase tracking-widest text-muted-foreground">Enter code to confirm</label>
                    <input
                      autoFocus
                      inputMode="numeric"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="mt-3 w-full rounded-2xl border border-border bg-background px-5 py-4 text-center text-2xl font-mono tracking-[0.5em] outline-none focus:border-foreground"
                    />
                    <button type="submit" disabled={busy || otpCode.length !== 6} className="mt-5 w-full rounded-full bg-foreground py-3 text-sm font-semibold text-background disabled:opacity-50">
                      {busy ? "Verifying…" : `Confirm ${title}`}
                    </button>
                  </form>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="mt-8 text-xs uppercase tracking-[0.3em] text-muted-foreground">
          {flash ? "Session ending" : "Waiting for next cadet"}
        </p>
      </main>
    </div>
  );
}
