import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/daily-report")({
  server: {
    handlers: {
      POST: async () =>
        new Response("This unauthenticated report hook is disabled. Generate reports from the authenticated admin dashboard.", { status: 410 }),
    },
  },
});
