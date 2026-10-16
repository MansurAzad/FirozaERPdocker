import { useEffect, useState, useSyncExternalStore } from "react";
import { CloudOff, RefreshCw, Trash2, CloudCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  discard,
  discardUnboundWrites,
  flushQueue,
  installOfflineQueue,
  queueSnapshot,
  retry,
  subscribeQueue,
  unboundQueueCount,
} from "@/lib/offline-queue";
import { registerServiceWorker } from "@/lib/pwa";

const empty: never[] = [];
export function OfflineStatus() {
  const queue = useSyncExternalStore(subscribeQueue, queueSnapshot, () => empty);
  const unboundCount = useSyncExternalStore(subscribeQueue, unboundQueueCount, () => 0);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    void installOfflineQueue();
    void registerServiceWorker();
    const s = () => setOnline(navigator.onLine);
    s();
    window.addEventListener("online", s);
    window.addEventListener("offline", s);
    return () => {
      window.removeEventListener("online", s);
      window.removeEventListener("offline", s);
    };
  }, []);
  if (online && queue.length === 0 && unboundCount === 0) return null;
  const failed = queue.filter((q) => q.error).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={
            "offline-status-trigger fixed bottom-3 left-3 z-[60] flex h-auto items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold shadow-lg print:hidden " +
            (failed
              ? "bg-destructive text-destructive-foreground"
              : online
                ? "bg-primary text-primary-foreground"
                : "bg-highlight text-foreground")
          }
        >
          {online ? <RefreshCw className="size-3.5" /> : <CloudOff className="size-3.5" />}
          {online ? "Syncing" : "Offline"} · {queue.length} pending
          {failed ? ` · ${failed} failed` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <p className="text-sm font-semibold">
          {online ? "Syncing queued entries" : "অফলাইন — cached data দেখছেন"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          আগে এই ডিভাইসে খোলা পেজের তথ্য পুরোনো হতে পারে। Pending write সার্ভার গ্রহণ না করা পর্যন্ত
          নিশ্চিত নয়; sales, purchase, stock ও money posting-এর server validation-এর জন্য internet
          দরকার।
        </p>
        {unboundCount > 0 && (
          <div className="mt-3 rounded-md border border-destructive/40 p-2 text-xs">
            <p>
              {unboundCount}টি পুরোনো pending entry account-এর সঙ্গে বাঁধা নয়, তাই sync বন্ধ রাখা
              হয়েছে। সার্ভারে অবস্থা যাচাই করে সঠিক account-এ আবার entry দিন।
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 h-7"
              onClick={() => void discardUnboundWrites()}
            >
              Discard quarantined entries
            </Button>
          </div>
        )}
        <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
          {queue.map((q) => (
            <li key={q.id} className="rounded-md border p-2 text-xs">
              <div className="flex justify-between gap-2">
                <span className="font-medium capitalize">{q.label}</span>
                <span className="text-muted-foreground">{new Date(q.at).toLocaleTimeString()}</span>
              </div>
              {q.error && (
                <>
                  <p className="mt-1 break-words text-destructive">{q.error}</p>
                  <div className="mt-1 flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs"
                      onClick={() => retry(q.id)}
                    >
                      <RefreshCw /> Retry
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs"
                      onClick={() => discard(q.id)}
                    >
                      <Trash2 /> Discard
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
        {online && (
          <Button size="sm" className="mt-3 w-full" onClick={() => flushQueue()}>
            <CloudCheck /> Sync now
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
