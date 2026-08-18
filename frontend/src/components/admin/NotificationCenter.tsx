import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Bell, CheckCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { queryKeys } from "@/api/query-keys";
import { archiveNotification, deleteNotification, fetchNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/admin-queries";

export function NotificationCenter() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.admin.notifications,
    queryFn: () => fetchNotifications("?limit=50"),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.notifications });
  const read = useMutation({ mutationFn: markNotificationRead, onSuccess: refresh });
  const markAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: refresh });
  const archive = useMutation({ mutationFn: (id: string) => archiveNotification(id, true), onSuccess: refresh });
  const remove = useMutation({ mutationFn: deleteNotification, onSuccess: refresh });
  const items = query.data?.notifications ?? [];
  return (
    <section className="rounded-2xl border border-border bg-card/95 p-4 shadow-xl backdrop-blur-md sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><Bell className="h-4 w-4" /> Notifications</h2><p className="text-sm text-muted-foreground">{query.data?.unread ?? 0} unread</p></div><button disabled={!query.data?.unread || markAll.isPending} onClick={() => markAll.mutate()} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs"><CheckCheck className="h-4 w-4" /> Mark all read</button></header>
      <div className="mt-4 max-h-[60dvh] space-y-2 overflow-y-auto pr-1">
        {query.isLoading && <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">Loading notifications…</p>}
        {query.isError && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">Notifications could not be loaded. <button onClick={() => query.refetch()} className="font-semibold underline">Retry</button></div>}
        {!query.isLoading && !query.isError && items.length === 0 && <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No notifications yet.</p>}
        {items.map((item) => <article key={item.notificationId} className={`rounded-xl border p-3 ${item.read ? "border-border bg-secondary/30" : "border-primary/30 bg-primary/5"}`}>
          <div className="flex items-start gap-3"><button aria-label={`Mark ${item.title} as read`} disabled={item.read} onClick={() => read.mutate(item.notificationId)} className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.read ? "bg-muted" : "bg-primary"}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{item.title}</h3><time className="text-[11px] text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</time></div><p className="mt-1 text-xs text-muted-foreground">{item.message}</p></div><div className="flex shrink-0 gap-1"><button aria-label="Archive notification" onClick={() => archive.mutate(item.notificationId)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-secondary"><Archive className="h-3.5 w-3.5" /></button><button aria-label="Delete notification" onClick={() => { if (confirm("Delete this notification?")) remove.mutate(item.notificationId); }} className="grid h-8 w-8 place-items-center rounded-full text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></button></div></div>
        </article>)}
      </div>
      {query.data?.hasMore && <button onClick={() => toast.info("Older notifications are available in notification history.")} className="mt-3 w-full rounded-full border border-border py-2 text-xs">Load older notifications</button>}
    </section>
  );
}
