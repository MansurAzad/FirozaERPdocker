import { describe, expect, it } from "vitest";
import {
  balanceAsOf,
  groupPartyEvents,
  outstandingDues,
  periodKey,
  selectReportColumns,
  type PartyReportEvent,
} from "./party-report";

const events: PartyReportEvent[] = [
  {
    id: "1",
    date: "2025-03-05",
    partyId: "c1",
    partyName: "Dealer A",
    partyKind: "dealer",
    branchName: "House",
    branchId: "branch1",
    eventKind: "sale",
    amount: 100,
  },
  {
    id: "2",
    date: "2025-03-06",
    partyId: "c1",
    partyName: "Dealer A",
    partyKind: "dealer",
    branchName: "House",
    branchId: "branch1",
    eventKind: "payment_in",
    amount: 40,
  },
  {
    id: "3",
    date: "2025-03-05",
    partyId: "s1",
    partyName: "Supplier B",
    partyKind: "supplier",
    branchName: "House",
    eventKind: "purchase",
    amount: 75,
  },
];

describe("party reports", () => {
  it("reconciles balances to the selected date by reversing later-dated activity", () => {
    expect(
      balanceAsOf(
        110,
        [
          { date: "2025-03-06", change: 20 },
          { date: "2025-03-07", change: -10 },
          { date: "2025-03-05", change: 5 },
        ],
        "2025-03-05",
      ),
    ).toBe(100);
  });

  it("uses calendar day, Monday-based week, and month buckets", () => {
    expect(periodKey("2025-03-05", "day")).toBe("2025-03-05");
    expect(periodKey("2025-03-05", "week")).toBe("2025-03-03");
    expect(periodKey("2025-03-05", "month")).toBe("2025-03");
  });

  it("groups activity by period, party, and branch without mixing suppliers and customers", () => {
    const rows = groupPartyEvents(events, "week", [
      {
        partyId: "c1",
        partyName: "Dealer A",
        partyKind: "dealer",
        branchName: "House",
        branchId: "branch1",
        currentDue: 60,
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      partyName: "Dealer A",
      period: "2025-03-03",
      sales: 100,
      paymentsIn: 40,
      currentDue: 60,
    });
    expect(rows[1]).toMatchObject({ partyName: "Supplier B", purchases: 75 });
  });

  it("can show all balances or only positive outstanding dues", () => {
    const dues = [
      {
        partyId: "a",
        partyName: "A",
        partyKind: "customer" as const,
        branchName: "Shop",
        currentDue: 0,
      },
      {
        partyId: "b",
        partyName: "B",
        partyKind: "supplier" as const,
        branchName: "All branches",
        currentDue: 25,
      },
    ];

    expect(outstandingDues(dues, true).map((row) => row.partyId)).toEqual(["b"]);
    expect(outstandingDues(dues, false)).toHaveLength(2);
  });

  it("uses the same selected columns in the report output", () => {
    expect(
      selectReportColumns(
        [
          ["period", "Period"],
          ["party", "Party"],
          ["sales", "Sales"],
        ],
        ["party", "sales"],
      ),
    ).toEqual([
      ["party", "Party"],
      ["sales", "Sales"],
    ]);
  });
});
