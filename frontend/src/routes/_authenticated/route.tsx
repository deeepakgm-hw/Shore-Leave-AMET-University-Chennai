import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { TokenService } from "@/services/token.service";
import { getCurrentUser } from "@/api/auth";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const token = TokenService.getToken();
    const cadetFaceToken = TokenService.getCadetFaceToken();
    if (!token && !cadetFaceToken) {
      try {
        await getCurrentUser();
      } catch {
        throw redirect({ to: "/auth", search: { role: "cadet" } });
      }
    }
    return { token, cadetFaceToken };
  },
  component: () => <Outlet />,
});
