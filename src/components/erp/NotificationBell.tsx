import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { friendlyError } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

type Notification = {
  id: string;
  title: string;
  message: string;
  type: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

function timeAgo(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const TONE: Record<string, string> = {
  success: "bg-success",
  warning: "bg-destructive",
  error: "bg-destructive",
  task: "bg-primary",
  mention: "bg-primary",
  info: "bg-muted-foreground",
};

export function NotificationBell() {
  const { business, userId } = useBusiness();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const { data: unread = 0 } = useQuery({
    queryKey: ["notif-count", business.id, userId],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unread_notifications_count")
        .select("unread_count")
        .eq("business_id", business.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data?.unread_count ?? 0;
    },
  });

  const list = useQuery({
    queryKey: ["notifications", business.id, userId],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_user_notifications", {
        _biz: business.id,
        _limit: 30,
        _unread_only: false,
      });
      if (error) throw error;
      return data as Notification[];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["notif-count"] });
  };

  const markOne = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mark_notification_read", { _notification_id: id });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e) => toast.error(friendlyError(e)),
  });

  const markAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("mark_all_notifications_read", { _biz: business.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("All notifications marked as read");
      refresh();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Notifications"
          title="Notifications"
        >
          <Bell className={cn("h-4 w-4", unread > 0 ? "text-primary" : "text-muted-foreground")} />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              disabled={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {(list.data ?? []).length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">No notifications yet.</p>
          ) : (
            <ul className="divide-y">
              {list.data?.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.read_at) markOne.mutate(n.id);
                      if (n.link) {
                        setOpen(false);
                        navigate({ to: n.link });
                      }
                    }}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors hover:bg-muted/60",
                      !n.read_at && "bg-primary/5",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          n.read_at ? "bg-transparent" : (TONE[n.type] ?? "bg-primary"),
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{n.title}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                    <p className="mt-0.5 pl-3.5 text-xs text-muted-foreground">{n.message}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
