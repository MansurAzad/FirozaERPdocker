import { describe, expect, it } from "vitest";
import { summarizeVisits } from "./visits";
import { nextHistory } from "./offline-queue";
const r = (p: string, s: string, u: string, t: string) => ({ path: p, session_id: s, user_name: u, visited_at: t });
describe("usage + sync history", () => {
  it("counts sessions and people separately from views", () => {
    const s = summarizeVisits([r("/app", "a", "Rafi", "2026-10-12T01:00Z"), r("/app/stock", "a", "Rafi", "2026-10-12T02:00Z"), r("/app", "b", "Mina", "2026-10-12T03:00Z")]);
    expect([s.views, s.sessions, s.people]).toEqual([3, 2, 2]);
    expect(s.pages[0]).toEqual(["/app", 2]);
  });
  it("failed then completed keeps one row with two tries", () => {
    const item = { id: "x", at: "t0", url: "", method: "POST", body: null, headers: {}, label: "create sale" };
    let h = nextHistory([], item, "pending", undefined, "t0");
    h = nextHistory(h, item, "failed", "IMEI sold", "t1");
    h = nextHistory(h, item, "completed", undefined, "t2");
    expect(h).toHaveLength(1);
    expect([h[0]!.status, h[0]!.attempts]).toEqual(["completed", 2]);
  });
});
