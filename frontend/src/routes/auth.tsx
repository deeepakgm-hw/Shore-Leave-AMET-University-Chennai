import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { cadetLogin, cadetRequestOtp, officerLogin, registerCadet } from "@/api/auth";
import { ApiError } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Layers, Loader2, ArrowLeft } from "lucide-react";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { TokenService } from "@/services/token.service";

const BRANCHES = [
  { code: "BE-MAERSK",  label: "B.E Marine Engineering (Maersk)"  },
  { code: "BSC-MAERSK", label: "B.Sc Nautical Science (Maersk)"   },
  { code: "ETO-MAERSK", label: "Electro-Technical Officer (Maersk)" },
  { code: "DNS-VSHIPS", label: "DNS (V.Ships)"                    },
  { code: "BE-VSHIPS",  label: "B.E Marine Engineering (V.Ships)" },
] as const;

const searchSchema = z.object({
  role: z.enum(["cadet", "admin"]).catch("cadet"),
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Sign in · Shore Leave" }] }),
  component: AuthPage,
});

function AuthPage() {
  const { role } = Route.useSearch();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [branch, setBranch] = useState<typeof BRANCHES[number]["code"]>("BE-MAERSK");
  const [loading, setLoading] = useState(false);
  const [cadetSessionToken, setCadetSessionToken] = useState<string | null>(null);
  const [cadetOtpEmail, setCadetOtpEmail] = useState("");
  const [rateLimitMessage, setRateLimitMessage] = useState("");
  const loginInFlightRef = useRef(false);

  useEffect(() => {
    if (role === "admin" && mode !== "signin") setMode("signin");
  }, [mode, role]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loginInFlightRef.current || loading) return;
    loginInFlightRef.current = true;
    setRateLimitMessage("");
    setLoading(true);
    try {
      if (mode === "signup") {
        if (role === "admin") throw new Error("Administrator accounts must be created by an existing administrator");
        const response = await registerCadet({ email, password, fullName, branch });
        if (!response.token) throw new Error("Signup did not return an authentication token");
        login(response.token);
        toast.success("Account created. Welcome aboard!");
        navigate({ to: "/cadet", replace: true });
      } else {
        if (role === "admin") {

  const response = await officerLogin({
    username: email,
    password,
  });

  if (!response.token) throw new Error("Officer login did not return an authentication token");
  login(response.token);

  toast.success("Administrator Login Successful");

  navigate({
    to: "/admin",
    replace: true,
  });

} else {
  if (!cadetSessionToken) {
    const response = await cadetRequestOtp({ roll: email, email: password });
    setCadetSessionToken(response.sessionToken);
    setCadetOtpEmail(password);
    setPassword("");
    toast.success("OTP sent. Enter it to continue.");
    return;
  }
  const response = await cadetLogin({
    roll: email,
    email: cadetOtpEmail,
    otp: password,
    sessionToken: cadetSessionToken,
  });
  if (response.token) {
    TokenService.removeCadetFaceToken();
    login(response.token);
    toast.success("Welcome back");
    navigate({
      to: "/cadet",
      replace: true,
    });
    return;
  }

  if (response.tempToken) {
    TokenService.removeToken();
    TokenService.setCadetFaceToken(response.tempToken);
    toast.success("OTP verified. Complete face verification to continue.");
    navigate({
      to: "/cadet",
      replace: true,
    });
    return;
  }

  throw new Error("Cadet login did not return an authentication token");

}
      }
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 429) {
        const waitText = error.retryAfterSeconds ? ` Try again in ${error.retryAfterSeconds} seconds.` : " Please wait before trying again.";
        const message = `${error.message}${waitText}`;
        setRateLimitMessage(message);
        toast.error(message);
        return;
      }
      toast.error(getErrorMessage(error, "Authentication failed"));
    } finally {
      loginInFlightRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-[#f1f7fd] px-6 py-12 text-slate-900" style={{ background: "linear-gradient(180deg, #c4e0fd 0%, #dfedfd 220px, #f0f6fc 550px, #f8fafc 1200px)" }}>
      <motion.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative w-full max-w-md"
      >
        <Link to="/" className="mb-6 inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Back home
        </Link>

        <div className="rounded-3xl border border-white/90 bg-white/95 p-8 shadow-xl shadow-blue-500/5 backdrop-blur-xl">
          <div className="flex items-center gap-2.5">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#0077f6] text-white shadow-sm">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <span className="font-extrabold tracking-tight text-slate-900 text-base">Shore Leave</span>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">AMET University</span>
            </div>
          </div>

          <h1 className="mt-6 text-2xl font-black tracking-tight text-slate-900">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {role === "admin" ? "Administrative management center" : "Cadet portal & digital gate pass"}
          </p>

          {/* Role indicator pills */}
          <div className="mt-5 inline-flex w-full rounded-2xl border border-slate-200 bg-slate-50 p-1 text-xs font-bold">
            <Link to="/auth" search={{ role: "cadet" }} className={`flex-1 rounded-xl py-2 text-center transition-all ${role === "cadet" ? "bg-[#0077f6] text-white shadow-xs" : "text-slate-500 hover:text-slate-900"}`}>Cadet</Link>
            <Link to="/auth" search={{ role: "admin" }} className={`flex-1 rounded-xl py-2 text-center transition-all ${role === "admin" ? "bg-[#0077f6] text-white shadow-xs" : "text-slate-500 hover:text-slate-900"}`}>Administrator</Link>
          </div>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {mode === "signup" && role === "cadet" && (
              <Field label="Full name" type="text" value={fullName} onChange={setFullName} required />
            )}
            {mode === "signup" && role === "cadet" && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-slate-600">Branch</span>
                <select
                  value={branch}
                  onChange={(e) => setBranch(e.target.value as typeof BRANCHES[number]["code"])}
                  required
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-800 outline-none transition-all focus:border-[#0077f6] focus:bg-white"
                >
                  {BRANCHES.map((b) => (
                    <option key={b.code} value={b.code}>{b.label}</option>
                  ))}
                </select>
              </label>
            )}
            <Field label={role === "admin" ? "Admin number or email" : role === "cadet" && mode === "signin" ? "Roll number" : "Email"} type={role === "admin" || (role === "cadet" && mode === "signin") ? "text" : "email"} value={email} onChange={(value) => { setEmail(value); setCadetSessionToken(null); }} required autoComplete="username" />
            <Field label={role === "cadet" && mode === "signin" ? (cadetSessionToken ? "OTP code" : "Registered email") : "Password"} type={role === "cadet" && mode === "signin" ? "text" : "password"} value={password} onChange={setPassword} required autoComplete={mode === "signin" ? "current-password" : "new-password"} />
            {rateLimitMessage && (
              <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
                {rateLimitMessage}
              </p>
            )}
            <button
              type="submit" disabled={loading}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#0077f6] py-3.5 text-sm font-bold text-white shadow-md shadow-blue-500/15 hover:bg-[#0066d6] transition-all disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {role === "cadet" && mode === "signin" && !cadetSessionToken ? "Send OTP" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          {role === "cadet" && (
            <button
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="mt-5 w-full text-center text-xs font-bold text-slate-500 hover:text-[#0077f6] transition-colors"
            >
              {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
            </button>
          )}

          {role === "admin" && (
            <p className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-3.5 text-xs text-blue-900 font-medium">
              Administrator accounts are created and OTP-verified by an existing administrator in Dashboard Settings.
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
}

type FieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> & {
  label: string; value: string; onChange: (v: string) => void; type?: string;
};
function Field({ label, value, onChange, type = "text", ...rest }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-slate-600">{label}</span>
      <input
        {...rest}
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-800 outline-none transition-all focus:border-[#0077f6] focus:bg-white focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}
