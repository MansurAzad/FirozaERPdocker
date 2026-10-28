import { describe, expect, it } from "vitest";
import { dhakaDate, lastDhakaDays } from "./dhaka-date";

describe("Dhaka calendar dates", () => {
  it("uses the Dhaka date when UTC is still on the previous day", () => {
    expect(dhakaDate(new Date("2026-10-28T19:00:00.000Z"))).toBe("2026-10-29");
  });

  it("returns consecutive Dhaka dates across a month boundary", () => {
    expect(lastDhakaDays(3, new Date("2026-11-01T01:00:00.000Z"))).toEqual([
      { date: "2026-10-30", label: "30 Oct" },
      { date: "2026-10-31", label: "31 Oct" },
      { date: "2026-11-01", label: "01 Nov" },
    ]);
  });

  it("rejects invalid day counts", () => {
    expect(() => lastDhakaDays(0)).toThrow(RangeError);
  });
});
