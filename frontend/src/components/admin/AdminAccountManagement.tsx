import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { apiRequest } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import { getErrorMessage } from "@/lib/errors";

const ADMIN_BRANCHES = [
  { code: "BE-MAERSK", label: "B.E Marine Engineering (Maersk)" },
  { code: "BSC-MAERSK", label: "B.Sc Nautical Science (Maersk)" },
  { code: "ETO-MAERSK", label: "Electro-Technical Officer (Maersk)" },
  { code: "DNS-VSHIPS", label: "DNS (V.Ships)" },
  { code: "BE-VSHIPS", label: "B.E Marine Engineering (V.Ships)" },
] as const;

type OfficerRecord = {
  username: string;
  adminNumber: string;
  email: string;
  role: string;
  branch: string;
  isActive: boolean;
  verifiedAt?: string | null;
};

type OtpRequestResponse = {
  success: boolean;
  sessionToken: string;
  expiresInSeconds: number;
  message: string;
};

type OtpConfirmResponse = {
  success: boolean;
  message: string;
  officer: OfficerRecord;
};

const fieldClass = "mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-xs text-slate-800 outline-none transition focus:border-[#0077f6] focus:bg-white focus:ring-2 focus:ring-blue-100";

export function AdminAccountManagement() {
  const queryClient = useQueryClient();
  const [adminNumber, setAdminNumber] = useState("");
  const [email, setEmail] = useState("");
  const [branch, setBranch] = useState(ADMIN_BRANCHES[0].code);
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [sessionToken, setSessionToken] = useState("");

  const officersQuery = useQuery({
    queryKey: ["admin", "officers"],
    queryFn: () => apiRequest<OfficerRecord[]>(endpoints.admin.officers),
  });

  const requestOtp = useMutation({
    mutationFn: () => apiRequest<OtpRequestResponse>(endpoints.admin.officerProvisionRequestOtp, {
      method: "POST",
      body: JSON.stringify({ adminNumber, email, branch, password }),
    }),
    onSuccess: (result) => {
      setSessionToken(result.sessionToken);
      setPassword("");
      setOtp("");
      toast.success(result.message || "Verification OTP sent");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Unable to send administrator verification OTP")),
  });

  const confirmOtp = useMutation({
    mutationFn: () => apiRequest<OtpConfirmResponse>(endpoints.admin.officerProvisionConfirm, {
      method: "POST",
      body: JSON.stringify({ sessionToken, otp }),
    }),
    onSuccess: async (result) => {
      toast.success(result.message || "Administrator account created");
      setAdminNumber("");
      setEmail("");
      setBranch(ADMIN_BRANCHES[0].code);
      setPassword("");
      setOtp("");
      setSessionToken("");
      await queryClient.invalidateQueries({ queryKey: ["admin", "officers"] });
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Unable to verify OTP")),
  });

  const canRequest = adminNumber.trim() && email.trim() && branch && password.length >= 8;
  const canConfirm = sessionToken && /^\d{6}$/.test(otp);

  return (
    <section className="mt-8 rounded-3xl border border-slate-100 bg-white p-7 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#0077f6]" />
            <h3 className="text-base font-extrabold text-slate-900">Administrator accounts</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">Create a branch administrator through verified email OTP. Public administrator signup is disabled.</p>
        </div>
        <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-[#0077f6]">Super Admin Only</span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-5">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <UserPlus className="h-4 w-4 text-[#0077f6]" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">New administrator</h4>
          </div>

          {!sessionToken ? (
            <form className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); requestOtp.mutate(); }}>
              <label className="text-xs font-bold text-slate-600">
                Unique admin number
                <input value={adminNumber} onChange={(event) => setAdminNumber(event.target.value.toUpperCase())} required autoComplete="off" placeholder="ADMIN-BSC-001" className={fieldClass} />
              </label>
              <label className="text-xs font-bold text-slate-600">
                Branch
                <select value={branch} onChange={(event) => setBranch(event.target.value as typeof branch)} className={fieldClass}>
                  {ADMIN_BRANCHES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-600 sm:col-span-2">
                Email
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="administrator@ametuniv.ac.in" className={fieldClass} />
              </label>
              <label className="text-xs font-bold text-slate-600 sm:col-span-2">
                Temporary password
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" className={fieldClass} />
              </label>
              <button type="submit" disabled={!canRequest || requestOtp.isPending} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0077f6] px-5 py-3 text-xs font-bold text-white shadow-sm hover:bg-[#0066d6] transition-all disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2">
                {requestOtp.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Send confirmation OTP
              </button>
            </form>
          ) : (
            <form className="mt-4" onSubmit={(event) => { event.preventDefault(); confirmOtp.mutate(); }}>
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900 font-medium">
                A six-digit verification code was sent to <strong>{email}</strong>. The account is not created until this code is confirmed.
              </div>
              <label className="mt-4 block text-xs font-bold text-slate-600">
                Verification OTP
                <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} required autoComplete="one-time-code" placeholder="000000" className={`${fieldClass} text-center font-mono text-lg font-bold tracking-[0.4em]`} />
              </label>
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="submit" disabled={!canConfirm || confirmOtp.isPending} className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[#0077f6] px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#0066d6] disabled:cursor-not-allowed disabled:opacity-50 transition-all">
                  {confirmOtp.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm and create
                </button>
                <button type="button" onClick={() => { setSessionToken(""); setOtp(""); }} className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              </div>
            </form>
          )}
        </div>

        <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-5">
          <div className="pb-3 border-b border-slate-100">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Existing administrators</h4>
            <p className="mt-0.5 text-xs text-slate-400">Verified accounts currently stored by the backend.</p>
          </div>
          <div className="mt-4 max-h-[390px] space-y-2.5 overflow-y-auto pr-1">
            {officersQuery.isLoading && <div className="flex items-center gap-2 py-4 text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading administrators…</div>}
            {officersQuery.isError && <button type="button" onClick={() => officersQuery.refetch()} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-600">Retry loading administrators</button>}
            {!officersQuery.isLoading && !officersQuery.isError && (officersQuery.data?.length ?? 0) === 0 && <p className="py-4 text-xs text-slate-400">No administrator accounts found.</p>}
            {officersQuery.data?.map((officer) => (
              <div key={officer.adminNumber || officer.username} className="rounded-2xl border border-slate-100 bg-white p-3.5 shadow-xs">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-slate-900">{officer.adminNumber || officer.username}</div>
                    <div className="truncate text-[11px] text-slate-400">{officer.email || "No email recorded"}</div>
                  </div>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${officer.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{officer.isActive ? "Active" : "Disabled"}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-medium text-slate-400"><span>{officer.branch || "All branches"}</span><span>•</span><span>{officer.role}</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
