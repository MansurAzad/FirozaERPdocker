import { describe as d, expect, it } from "vitest";
import { describe, isQueueableWrite, isServerRpcWrite } from "./offline-queue";

const base = "https://x.supabase.co";
d("offline queue", () => {
  it("queues plain table writes but not reads or server RPCs", () => {
    expect(isQueueableWrite(`${base}/rest/v1/rpc/create_sale`, "POST", base)).toBe(false);
    expect(isQueueableWrite(`${base}/rest/v1/customers`, "PATCH", base)).toBe(true);
    expect(isQueueableWrite(`${base}/rest/v1/customers?select=*`, "GET", base)).toBe(false);
    expect(isQueueableWrite(`${base}/auth/v1/token`, "POST", base)).toBe(false);
    expect(isServerRpcWrite(`${base}/rest/v1/rpc/create_sale`, "POST", base)).toBe(true);
    expect(isServerRpcWrite(`${base}/rest/v1/customers`, "PATCH", base)).toBe(false);
  });
  it("labels entries in plain words", () => {
    expect(describe(`${base}/rest/v1/rpc/create_sale`, "POST")).toBe("create sale");
    expect(describe(`${base}/rest/v1/customers`, "POST")).toBe("add customers");
  });
});
