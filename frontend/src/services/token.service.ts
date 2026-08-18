const LEGACY_TOKEN_KEY = "shore_leave_token";
const LEGACY_CADET_FACE_TOKEN_KEY = "shore_leave_cadet_face_token";
let accessToken: string | null = null;
let cadetFaceToken: string | null = null;

if (typeof window !== "undefined") {
  // Authentication is now backed by an HttpOnly cookie. Remove tokens left by
  // older builds so an XSS cannot recover them from browser storage.
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(LEGACY_CADET_FACE_TOKEN_KEY);
}

export interface JwtPayload {
  exp?: number;
  role?: string;
  username?: string;
  roll?: string;
  sessionId?: string;
}

function decodePayload(token: string): JwtPayload | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized)) as JwtPayload;
  } catch {
    return null;
  }
}

function notifyTokenChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("shoreleave:token-changed"));
}

export const TokenService = {
  getToken(): string | null {
    return accessToken;
  },

  setToken(token: string): void {
    if (typeof window === "undefined") {
      return;
    }

    accessToken = token;
    notifyTokenChanged();
  },

  removeToken(): void {
    if (typeof window === "undefined") {
      return;
    }

    accessToken = null;
    notifyTokenChanged();
  },

  getCadetFaceToken(): string | null {
    if (typeof window === "undefined") {
      return null;
    }

    return cadetFaceToken;
  },

  setCadetFaceToken(token: string): void {
    if (typeof window === "undefined") {
      return;
    }

    cadetFaceToken = token;
    notifyTokenChanged();
  },

  removeCadetFaceToken(): void {
    if (typeof window === "undefined") {
      return;
    }

    cadetFaceToken = null;
    notifyTokenChanged();
  },

  clearAll(): void {
    if (typeof window === "undefined") {
      return;
    }

    accessToken = null;
    cadetFaceToken = null;
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_CADET_FACE_TOKEN_KEY);
    notifyTokenChanged();
  },

  isExpired(token: string): boolean {
    const exp = decodePayload(token)?.exp;
    return typeof exp === "number" && exp * 1000 <= Date.now();
  },

  getRole(token: string): string | undefined {
    return decodePayload(token)?.role;
  },

  decode(token: string): JwtPayload | null {
    return decodePayload(token);
  },
};
