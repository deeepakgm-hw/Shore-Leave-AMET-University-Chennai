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
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-6 text-foreground">
      <div className="pointer-events-none absolute inset-0 hero-glow opacity-70" />
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-30 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />

      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="relative w-full max-w-md"
      >
        <Link to="/" className="mb-6 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back home
        </Link>

        <div className="rounded-3xl border border-border bg-card/70 p-8 backdrop-blur-xl shadow-2xl">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent">
              <Layers className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold tracking-tight">Shore Leave</span>
          </div>

          <h1 className="mt-6 text-2xl font-semibold tracking-tight">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {role === "admin" ? "Administrator portal" : "Cadet portal"}
          </p>

          {/* Role indicator pills */}
          <div className="mt-5 inline-flex rounded-full border border-border bg-secondary/40 p-1 text-xs">
            <Link to="/auth" search={{ role: "cadet" }} className={`rounded-full px-3 py-1 ${role === "cadet" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Cadet</Link>
            <Link to="/auth" search={{ role: "admin" }} className={`rounded-full px-3 py-1 ${role === "admin" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Administrator</Link>
          </div>

          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            {mode === "signup" && role === "cadet" && (
              <Field label="Full name" type="text" value={fullName} onChange={setFullName} required />
            )}
            {mode === "signup" && role === "cadet" && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Branch</span>
                <select
                  value={branch}
                  onChange={(e) => setBranch(e.target.value as typeof BRANCHES[number]["code"])}
                  required
                  className="w-full rounded-xl border border-border bg-background/60 px-4 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
                >
                  {BRANCHES.map((b) => (
                    <option key={b.code} value={b.code}>{b.label}</option>
                  ))}
                </select>
              </label>
            )}
            <Field label={role === "admin" ? "Admin number or email" : role === "cadet" && mode === "signin" ? "Roll number" : "Email"} type={role === "admin" || (role === "cadet" && mode === "signin") ? "text" : "email"} value={email} onChange={(value) => { setEmail(value); setCadetSessionToken(null); }} required autoComplete="username" />
            <Field label={role === "cadet" && mode === "signin" ? (cadetSessionToken ? "OTP" : "Registered email") : "Password"} type={role === "cadet" && mode === "signin" ? "text" : "password"} value={password} onChange={setPassword} required autoComplete={mode === "signin" ? "current-password" : "new-password"} />
            {rateLimitMessage && (
              <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs font-medium text-warning">
                {rateLimitMessage}
              </p>
            )}
            <button
              type="submit" disabled={loading}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent py-3 text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_-10px_oklch(0.72_0.18_45/0.6)] transition-transform hover:scale-[1.01] disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {role === "cadet" && mode === "signin" && !cadetSessionToken ? "Send OTP" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          {role === "cadet" && (
            <button
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="mt-5 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
            </button>
          )}

          {role === "admin" && (
            <p className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
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
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      <input
        {...rest}
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-border bg-background/60 px-4 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
      />
    </label>
  );
}
