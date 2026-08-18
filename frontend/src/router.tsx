import { QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const toastCooldown = new Map<string, number>();
const TOAST_COOLDOWN_MS = 30_000;

function shouldToast(error: unknown) {
  const status = error instanceof ApiError ? error.status : "unknown";
  const message = getErrorMessage(error, "Unable to load data. Please retry.");
  const key = `${status}:${message}`;
  const now = Date.now();
  const lastShown = toastCooldown.get(key) ?? 0;
  if (now - lastShown < TOAST_COOLDOWN_MS) return false;
  toastCooldown.set(key, now);
  return true;
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (error instanceof ApiError && error.status === 401) return;
        if (!shouldToast(error)) return;
        const fallback = query.state.data !== undefined
          ? "Unable to refresh data"
          : "Unable to load data. Please retry.";
        toast.error(getErrorMessage(error, fallback));
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && [0, 400, 401, 403, 404, 408, 409, 422, 429].includes(error.status)) return false;
          return failureCount < 1;
        },
        // Page queries render their own loading/retry/inline-error states. Escalating
        // ordinary API failures to the root boundary made a single slow request take
        // down the entire application with "This page didn't load".
        throwOnError: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
