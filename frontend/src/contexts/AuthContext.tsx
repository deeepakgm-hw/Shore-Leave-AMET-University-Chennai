import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";

import { TokenService } from "../services/token.service";
import { logoutSession } from "../api/auth";

interface AuthContextType {
  token: string | null;
  login: (token: string) => void;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {

  const [token, setToken] = useState<string | null>(() => TokenService.getToken());

  useEffect(() => {
    const syncToken = () => setToken(TokenService.getToken());
    window.addEventListener("storage", syncToken);
    window.addEventListener("shoreleave:token-changed", syncToken);
    return () => {
      window.removeEventListener("storage", syncToken);
      window.removeEventListener("shoreleave:token-changed", syncToken);
    };
  }, []);

  const login = (jwt: string) => {
    TokenService.removeCadetFaceToken();
    TokenService.setToken(jwt);
    setToken(jwt);
  };

  const logout = async () => {
    try {
      await logoutSession();
    } catch {
      // Local cleanup must still complete when the network is unavailable.
    }
    TokenService.clearAll();
    setToken(null);
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        login,
        logout,
        isAuthenticated: !!token,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
