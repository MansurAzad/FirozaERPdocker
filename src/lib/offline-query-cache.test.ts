import { describe, expect, it } from "vitest";
import { offlineQueryCacheKey, OFFLINE_QUERY_CACHE_MAX_AGE } from "./offline-query-cache";

describe("offline query cache", () => {
  it("uses a separate local cache key for each signed-in account", () => {
    expect(offlineQueryCacheKey("user-a")).not.toBe(offlineQueryCacheKey("user-b"));
    expect(offlineQueryCacheKey("user-a")).toContain("user-a");
  });

  it("expires cached ERP data after 24 hours", () => {
    expect(OFFLINE_QUERY_CACHE_MAX_AGE).toBe(24 * 60 * 60 * 1000);
  });
});
