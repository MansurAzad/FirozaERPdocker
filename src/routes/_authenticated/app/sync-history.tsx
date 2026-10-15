import { useSyncExternalStore } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, Trash2, CloudCheck } from "lucide-react";
import { matchedCompany } from "@/lib/branding";
import { PageHeader } from "@/components/erp/EntityManager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { clearFinishedHistory, discard, flushQueue, historySnapshot, retry, subscribeQueue, type SyncEvent } from "@/lib/offline-queue";

export const Route = createFileRoute("/_authenticated/app/sync-history")({
  head: ({ matches }) => ({
    meta: [
      { title: `Offline Sync History — ${matchedCompany(matches)}` },
      { name: "description", content: `Pending, completed and failed offline entries in ${matchedCompany(matches)}.` },
      { property: "og:title", content: `Offline Sync History — ${matchedCompany(matches)}` },
      { property: "og:description", content: `Pending, completed and failed offline entries in ${matchedCompany(matches)}.` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SyncHistoryPage,
});

const empty: SyncEvent[] = [];
const STATUS: Record<SyncEvent["status"], { label: string; cls: string }> = {
  pending: { label: "Pending · অপেক্ষমাণ", cls: "bg-highlight text-foreground" },
  completed: { label: "Completed · সম্পন্ন", cls: "bg-primary text-primary-foreground" },
  failed: { label: "Failed · ব্যর্থ", cls: "bg-destructive text-destructive-foreground" },
  discarded: { label: "Discarded · বাতিল", cls: "bg-muted text-muted-foreground" },
};
const fmt = (s: string) => new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" });

function guidance(error = "") {
  const e = error.toLowerCase();
  if (e.includes("imei") || e.includes("stock") || e.includes("insufficient"))
    return "Stock/IMEI was already used on another device. Check Stock or IMEI search, then enter the sale again with an available unit. Do not retry.";
  if (e.includes("credit") || e.includes("limit") || e.includes("balance"))
    return "Customer credit or account balance changed. Check the customer due, then re-enter with manager approval if needed.";
  if (e.includes("duplicate") || e.includes("unique"))
    return "This record already exists on the server — likely saved from another device. Check before re-entering; Discard is usually safe.";
  if (e.includes("permission") || e.includes("401") || e.includes("403") || e.includes("jwt"))
    return "Your sign-in expired or your role cannot do this. Sign in again, then Retry once.";
  return "Retry once. If it fails again, check the record on the server and re-enter it manually instead of retrying repeatedly.";
}

function SyncHistoryPage() {
  const history = useSyncExternalStore(subscribeQueue, historySnapshot, () => empty);
  const count = (s: SyncEvent["status"]) => history.filter((h) => h.status === s).length;
  return (
    <div className="space-y-5">
      <PageHeader title="Offline sync history · অফলাইন সিঙ্ক ইতিহাস" sub="Entries saved on this device while offline, and what happened when they were sent to the server." />
      <div className="grid gap-3 sm:grid-cols-4">
        {(["pending", "completed", "failed", "discarded"] as const).map((s) => (
          <Card key={s}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{STATUS[s].label}</p><p className="text-2xl font-bold">{count(s)}</p></CardContent></Card>
        ))}
      </div>
      <Card><CardContent className="space-y-1 p-4 text-sm">
        <p className="font-semibold">Safe retry guide · নিরাপদে আবার চেষ্টা</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Pending entries upload automatically when internet returns (every 30 seconds) — no action needed.</li>
          <li>The server re-checks stock, IMEI and balances. A failed entry was <b>not</b> saved, so nothing is doubled.</li>
          <li>Retry only for network or sign-in problems. For stock/IMEI conflicts, re-enter the sale with an available unit and Discard the failed one.</li>
          <li>This history is kept on this device only; each device shows its own entries.</li>
        </ul>
      </CardContent></Card>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => flushQueue()}><CloudCheck /> Sync now</Button>
        <Button size="sm" variant="outline" onClick={() => clearFinishedHistory()}>Clear completed/discarded</Button>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Entry</TableHead><TableHead>Status</TableHead><TableHead>Saved offline</TableHead><TableHead>Last update</TableHead><TableHead>Tries</TableHead><TableHead>Details & guidance</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {history.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No offline entries on this device yet.</TableCell></TableRow>}
          {history.map((h) => (
            <TableRow key={h.id}>
              <TableCell className="font-medium capitalize">{h.label}</TableCell>
              <TableCell><Badge className={STATUS[h.status].cls}>{STATUS[h.status].label}</Badge></TableCell>
              <TableCell className="whitespace-nowrap text-xs">{fmt(h.queuedAt)}</TableCell>
              <TableCell className="whitespace-nowrap text-xs">{fmt(h.updatedAt)}</TableCell>
              <TableCell>{h.attempts}</TableCell>
              <TableCell className="max-w-md text-xs">
                {h.error && <p className="break-words text-destructive">{h.error}</p>}
                {h.status === "failed" && <p className="mt-1">{guidance(h.error)}</p>}
              </TableCell>
              <TableCell>
                {h.status === "failed" && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-7" onClick={() => retry(h.id)}><RefreshCw /> Retry</Button>
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => discard(h.id)}><Trash2 /> Discard</Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
