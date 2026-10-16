import type { QueryClient } from "@tanstack/react-query";

const LEGACY_CACHE_KEY = "firoza.query-cache";
const CACHE_PREFIX = "firoza.query-cache:v2:";
const MAX_AGE = 24 * 60 * 60 * 1000;
const BUSTER = "firoza-offline-v2";

type ActiveCache = {
  userId: string;
  key: string;
  stop: () => void;
  restored: Promise<void>;
};

const activeCaches = new WeakMap<QueryClient, ActiveCache>();
const pendingRestores = new WeakMap<QueryClient, { userId: string; promise: Promise<void> }>();
const cacheGenerations = new WeakMap<QueryClient, number>();

function advanceGeneration(queryClient: QueryClient) {
  const generation = (cacheGenerations.get(queryClient) ?? 0) + 1;
  cacheGenerations.set(queryClient, generation);
  return generation;
}

export function offlineQueryCacheKey(userId: string) {
  return `${CACHE_PREFIX}${userId}`;
}

export async function purgeLegacyOfflineQueryCache() {
  const idb = await import("idb-keyval");
  await idb.del(LEGACY_CACHE_KEY);
}

export function restoreOfflineQueryCache(queryClient: QueryClient, userId: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const active = activeCaches.get(queryClient);
  if (active?.userId === userId) {
    return active.restored;
  }

  const pending = pendingRestores.get(queryClient);
  if (pending?.userId === userId) return pending.promise;

  const generation = advanceGeneration(queryClient);
  if (active) {
    active.stop();
    activeCaches.delete(queryClient);
  }
  if (active || pending) queryClient.clear();

  const promise = (async () => {
    const idb = await import("idb-keyval");
    if (active) await idb.del(active.key);
    if (pending) {
      await pending.promise.catch(() => undefined);
      await idb.del(offlineQueryCacheKey(pending.userId));
    }
    await startOfflineQueryCache(queryClient, userId, generation);
  })();
  const next = { userId, promise };
  pendingRestores.set(queryClient, next);
  return promise.finally(() => {
    if (pendingRestores.get(queryClient) === next) pendingRestores.delete(queryClient);
  });
}

async function startOfflineQueryCache(
  queryClient: QueryClient,
  userId: string,
  generation: number,
) {
  if (cacheGenerations.get(queryClient) !== generation) return;
  const active = activeCaches.get(queryClient);
  if (active) {
    active.stop();
    activeCaches.delete(queryClient);
    queryClient.clear();
    const idb = await import("idb-keyval");
    await idb.del(active.key);
  }

  const [persistClient, createPersister, idb] = await Promise.all([
    import("@tanstack/react-query-persist-client"),
    import("@tanstack/query-async-storage-persister"),
    import("idb-keyval"),
  ]);
  if (cacheGenerations.get(queryClient) !== generation) return;
  await idb.del(LEGACY_CACHE_KEY);
  const key = offlineQueryCacheKey(userId);
  const persister = createPersister.createAsyncStoragePersister({
    key,
    throttleTime: 1000,
    storage: {
      getItem: async (storageKey) => (await idb.get<string>(storageKey)) ?? null,
      setItem: (storageKey, value) => idb.set(storageKey, value),
      removeItem: (storageKey) => idb.del(storageKey),
    },
  });
  const [stop, restored] = persistClient.persistQueryClient({
    queryClient,
    persister,
    maxAge: MAX_AGE,
    buster: BUSTER,
  });
  const next: ActiveCache = { userId, key, stop, restored };
  activeCaches.set(queryClient, next);

  try {
    await restored;
    if (cacheGenerations.get(queryClient) !== generation) {
      stop();
      if (activeCaches.get(queryClient) === next) activeCaches.delete(queryClient);
      return;
    }
    await persistClient.persistQueryClientSave({ queryClient, persister, buster: BUSTER });
  } catch (error) {
    stop();
    if (
      cacheGenerations.get(queryClient) === generation &&
      activeCaches.get(queryClient) === next
    ) {
      activeCaches.delete(queryClient);
      queryClient.clear();
    }
    throw error;
  }
}

export async function clearOfflineQueryCache(queryClient: QueryClient) {
  const generation = advanceGeneration(queryClient);
  const active = activeCaches.get(queryClient);
  if (active) {
    active.stop();
    activeCaches.delete(queryClient);
  }
  const pending = pendingRestores.get(queryClient);
  queryClient.clear();
  if (pending) await pending.promise.catch(() => undefined);
  if (cacheGenerations.get(queryClient) !== generation) return;
  queryClient.clear();
  const { del } = await import("idb-keyval");
  if (active) await del(active.key);
  if (pending) await del(offlineQueryCacheKey(pending.userId));
  await del(LEGACY_CACHE_KEY);
}

export const OFFLINE_QUERY_CACHE_MAX_AGE = MAX_AGE;
