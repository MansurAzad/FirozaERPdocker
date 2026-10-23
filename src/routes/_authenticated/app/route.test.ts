import { describe, expect, it } from "vitest";
import { normalizeBusinessMemberships } from "./route";

describe("business membership normalization", () => {
  it("accepts both aliased and legacy business joins from Supabase", () => {
    const normalized = normalizeBusinessMemberships([
      {
        role: "owner",
        business: {
          id: "biz-1",
          name: "Alpha",
          phone: "123",
          address: "Main",
          currency: "BDT",
          type: "dealer",
        },
      },
      {
        role: "manager",
        businesses: {
          id: "biz-2",
          name: "Beta",
          phone: "456",
          address: "Second",
          currency: "BDT",
          type: "shop",
        },
      },
    ] as any);

    expect(normalized).toHaveLength(2);
    expect(normalized[0]).toMatchObject({ business: { id: "biz-1" }, role: "owner" });
    expect(normalized[1]).toMatchObject({ business: { id: "biz-2" }, role: "manager" });
  });
});
