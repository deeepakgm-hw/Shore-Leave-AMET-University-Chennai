import { apiRequest } from "./client";
import type { LoginRequest, LoginResponse, RefreshResponse } from "../types";
import type { CurrentUser } from "../types";
import { endpoints } from "./endpoints";

export const officerLogin = (data: LoginRequest) =>
  apiRequest<LoginResponse>(endpoints.auth.officerLogin, { method: "POST", body: JSON.stringify(data) });

export const refreshToken = () =>
  apiRequest<RefreshResponse>(endpoints.auth.refresh, { method: "POST" });

export const logoutSession = () =>
  apiRequest<{ success: boolean }>(endpoints.auth.logout, { method: "POST" });

export const deleteCurrentAccount = (confirmRoll: string) =>
  apiRequest<{ success: boolean; message: string }>(endpoints.auth.deleteAccount, {
    method: "DELETE",
    body: JSON.stringify({ confirmRoll }),
  });

export const cadetRequestOtp = (data: { roll: string; email: string }) =>
  apiRequest<{ sessionToken: string; expiresIn: number; resendCooldown: number; message?: string }>(
    endpoints.auth.cadetRequestOtp,
    { method: "POST", body: JSON.stringify(data) },
  );

export const cadetLogin = (data: { roll: string; email: string; otp: string; sessionToken: string }) =>
  apiRequest<LoginResponse>(endpoints.auth.cadetVerifyOtp, { method: "POST", body: JSON.stringify(data) });

export interface CadetFaceVerificationPayload {
  imageBase64?: string;
  location?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  };
}

export const cadetVerifyFace = (data: CadetFaceVerificationPayload, tempToken: string) =>
  apiRequest<LoginResponse>(endpoints.auth.cadetVerifyFace, {
    method: "POST",
    headers: { Authorization: `Bearer ${tempToken}` },
    body: JSON.stringify(data),
  });

export const registerCadet = (data: { email: string; password: string; fullName: string; branch: string }) =>
  Promise.reject(new Error("Cadet self-registration is not available. Contact the administration.")) as Promise<LoginResponse>;

type BackendAuthRole = CurrentUser["role"] | "duty_officer" | "cadet_pending_face";

interface BackendAuthEntity {
  id?: string;
  _id?: string;
  username?: string;
  email?: string;
  fullName?: string;
  full_name?: string;
  name?: string;
  roll?: string;
  role?: BackendAuthRole;
}

interface AuthMeResponse extends BackendAuthEntity {
  success?: boolean;
  authenticated?: boolean;
  role?: BackendAuthRole;
  user?: BackendAuthEntity;
  officer?: BackendAuthEntity;
  cadet?: BackendAuthEntity;
}

const normalizeRole = (role?: BackendAuthRole): CurrentUser["role"] | undefined => {
  if (role === "duty_officer") return "officer";
  if (role === "cadet_pending_face") return "cadet";
  return role;
};

export const getCurrentUser = async (): Promise<CurrentUser> => {
  const response = await apiRequest<AuthMeResponse>(endpoints.auth.me);
  const entity = response.user ?? response.officer ?? response.cadet ?? response;
  const role = normalizeRole(entity.role ?? response.role);
  if (!role) throw new Error("Invalid authentication response");

  const name = entity.fullName ?? entity.full_name ?? entity.name ?? entity.username ?? entity.roll;

  return {
    id: entity.id ?? entity._id ?? entity.username ?? entity.roll,
    _id: entity._id,
    username: entity.username ?? entity.roll,
    email: entity.email ?? entity.username,
    fullName: name,
    full_name: name,
    role,
  };
};
