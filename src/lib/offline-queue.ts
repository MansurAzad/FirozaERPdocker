// Offline write queue: any change sent to the cloud database while offline is stored on the
// device (IndexedDB) and replayed in order when the connection returns. The database functions
// re-check stock, IMEI and balances on replay, so conflicting entries are rejected, not merged.
import { get, set } from "idb-keyval";
import { supabase } from "@/integrations/supabase/client";

export type QueuedWrite = {
  id: string;
  at: string;
  userId?: string;
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
  label: string;
  error?: string | undefined;
};
const KEY = "firoza.offline-queue";
const HKEY = "firoza.sync-history";
export type SyncEvent = {
  id: string;
  userId?: string;
  label: string;
  queuedAt: string;
  status: "pending" | "completed" | "failed" | "discarded";
  updatedAt: string;
  attempts: number;
  error?: string | undefined;
};
let history: SyncEvent[] = [];
let cache: QueuedWrite[] = [];
let activeUserId: string | null = null;
let visibleHistory: SyncEvent[] = [];
let visibleQueue: QueuedWrite[] = [];
export const historySnapshot = () => visibleHistory;
export const unboundQueueCount = () => cache.filter((item) => !item.userId).length;
/** Records a status change for one queued entry (keeps the latest 300 on this device). */
export function nextHistory(
  h: SyncEvent[],
  item: QueuedWrite,
  status: SyncEvent["status"],
  error?: string,
  now = new Date().toISOString(),
) {
  const prev = h.find((e) => e.id === item.id);
  const ev: SyncEvent = {
    id: item.id,
    ...(item.userId ? { userId: item.userId } : {}),
    label: item.label,
    queuedAt: item.at,
    status,
    updatedAt: now,
    attempts: (prev?.attempts ?? 0) + (status === "completed" || status === "failed" ? 1 : 0),
    error,
  };
  return [ev, ...h.filter((e) => e.id !== item.id)].slice(0, 300);
}
async function track(item: QueuedWrite, status: SyncEvent["status"], error?: string) {
  history = nextHistory(history, item, status, error);
  await set(HKEY, history);
  emit();
}
export async function clearFinishedHistory() {
  history = history.filter(
    (e) => e.userId !== activeUserId || e.status === "pending" || e.status === "failed",
  );
  await set(HKEY, history);
  emit();
}
const listeners = new Set<() => void>();
let flushing = false;

export const subscribeQueue = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));
export const queueSnapshot = () => visibleQueue;
const emit = () => {
  visibleQueue = activeUserId ? cache.filter((item) => item.userId === activeUserId) : [];
  visibleHistory = activeUserId ? history.filter((event) => event.userId === activeUserId) : [];
  listeners.forEach((l) => l());
};
async function save(q: QueuedWrite[]) {
  cache = q;
  await set(KEY, q);
  emit();
}

export function describe(url: string, method: string) {
  const p = new URL(url).pathname;
  const rpc = /\/rpc\/([^/?]+)/.exec(p)?.[1];
  if (rpc) return rpc.replace(/_/g, " ");
  const table = /\/rest\/v1\/([^/?]+)/.exec(p)?.[1] ?? "record";
  return `${method === "POST" ? "add" : method === "DELETE" ? "delete" : "update"} ${table.replace(/_/g, " ")}`;
}

/** True when a request is a database write that may be queued. */
export function isQueueableWrite(url: string, method: string, base: string) {
  return method !== "GET" && method !== "HEAD" && url.startsWith(base) && url.includes("/rest/v1/");
}

export function canReplayWrite(item: Pick<QueuedWrite, "userId">, userId: string | null) {
  return Boolean(userId && item.userId === userId);
}

const SKIP_HEADERS = new Set(["authorization", "apikey", "x-client-info"]);

async function enqueue(url: string, init: RequestInit) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user.id) throw new Error("Sign in again before saving offline changes.");
  activeUserId = session.user.id;
  const h: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => {
    if (!SKIP_HEADERS.has(k)) h[k] = v;
  });
  const item: QueuedWrite = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    userId: session.user.id,
    url,
    method: init.method ?? "POST",
    body: typeof init.body === "string" ? init.body : null,
    headers: h,
    label: describe(url, init.method ?? "POST"),
  };
  await save([...cache, item]);
  await track(item, "pending");
}

export async function flushQueue() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    const userId = session?.user.id;
    const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string;
    if (!userId) return;
    for (const item of [...cache]) {
      if (item.error || !canReplayWrite(item, userId)) continue;
      const { data: current } = await supabase.auth.getSession();
      if (current.session?.user.id !== userId || !current.session.access_token) return;
      let res: Response;
      try {
        res = await originalFetch(item.url, {
          method: item.method,
          body: item.body,
          headers: {
            ...item.headers,
            apikey: key,
            Authorization: `Bearer ${current.session.access_token}`,
          },
        });
      } catch {
        return;
      } // still offline — try later
      const rest = cache.filter((q) => q.id !== item.id);
      if (res.ok) {
        await save(rest);
        await track(item, "completed");
      } else {
        const error = (await res.text()).slice(0, 300) || String(res.status);
        await save([...rest, { ...item, error }]);
        await track(item, "failed", error);
      }
    }
  } finally {
    flushing = false;
  }
}

export async function discard(id: string) {
  const item = cache.find((q) => q.id === id);
  await save(cache.filter((q) => q.id !== id));
  if (item) await track(item, "discarded", item.error);
}
export async function discardUnboundWrites() {
  const unboundIds = new Set(cache.filter((item) => !item.userId).map((item) => item.id));
  if (unboundIds.size === 0) return;
  await save(cache.filter((item) => !unboundIds.has(item.id)));
  history = history.filter((event) => !unboundIds.has(event.id));
  await set(HKEY, history);
  emit();
}
export async function retry(id: string) {
  const item = cache.find((q) => q.id === id);
  await save(cache.map((q) => (q.id === id ? { ...q, error: undefined } : q)));
  if (item) await track(item, "pending");
  await flushQueue();
}

let originalFetch: typeof fetch = (...a) => fetch(...a);

/** Installs the offline-aware fetch once in the browser. */
export async function installOfflineQueue() {
  if (typeof window === "undefined" || (window as { __firozaQueue?: boolean }).__firozaQueue)
    return;
  (window as { __firozaQueue?: boolean }).__firozaQueue = true;
  cache = (await get<QueuedWrite[]>(KEY)) ?? [];
  history = (await get<SyncEvent[]>(HKEY)) ?? [];
  const {
    data: { session },
  } = await supabase.auth.getSession();
  activeUserId = session?.user.id ?? null;
  supabase.auth.onAuthStateChange((_event, nextSession) => {
    activeUserId = nextSession?.user.id ?? null;
    emit();
    if (nextSession) void flushQueue();
  });
  emit();
  const base = import.meta.env["VITE_SUPABASE_URL"] as string;
  originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (!isQueueableWrite(url, method, base)) return originalFetch(input, init);
    if (navigator.onLine) {
      try {
        return await originalFetch(input, init);
      } catch (e) {
        if (navigator.onLine) throw e;
      }
    }
    await enqueue(url, { ...init, method });
    return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
  };
  window.addEventListener("online", () => void flushQueue());
  setInterval(() => void flushQueue(), 30_000);
  void flushQueue();
}
