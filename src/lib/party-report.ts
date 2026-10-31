export type PartyKind = "customer" | "dealer" | "supplier";
export type ReportPeriod = "day" | "week" | "month";
export type PartyReportMode = "transactions" | "dues";
export type ReportColumn = readonly [key: string, label: string];

export type PartyReportEvent = {
  id: string;
  date: string;
  partyId: string;
  partyName: string;
  partyKind: PartyKind;
  branchName: string;
  branchId?: string;
  eventKind:
    | "sale"
    | "payment_in"
    | "sales_return"
    | "refund_out"
    | "purchase"
    | "payment_out"
    | "purchase_return"
    | "refund_in";
  amount: number;
};

export type PartyReportGroup = {
  period: string;
  partyId: string;
  partyName: string;
  partyKind: PartyKind;
  branchName: string;
  branchId?: string;
  sales: number;
  paymentsIn: number;
  salesReturns: number;
  refundsOut: number;
  purchases: number;
  paymentsOut: number;
  purchaseReturns: number;
  refundsIn: number;
  currentDue: number;
};

export type PartyDueRow = {
  partyId: string;
  partyName: string;
  partyKind: PartyKind;
  branchName: string;
  branchId?: string;
  currentDue: number;
};

export type DatedBalanceChange = { date: string; change: number };

export function balanceAsOf(
  currentBalance: number,
  changes: DatedBalanceChange[],
  asOfDate: string,
): number {
  const futureChange = changes.reduce(
    (total, change) => total + (change.date > asOfDate ? change.change : 0),
    0,
  );
  return Math.round((currentBalance - futureChange + Number.EPSILON) * 100) / 100;
}

export function periodKey(date: string, period: ReportPeriod): string {
  if (period === "month") return date.slice(0, 7);
  if (period === "day") return date;
  const parsed = new Date(`${date}T00:00:00`);
  const mondayOffset = (parsed.getDay() + 6) % 7;
  parsed.setDate(parsed.getDate() - mondayOffset);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function groupPartyEvents(
  events: PartyReportEvent[],
  period: ReportPeriod,
  dues: PartyDueRow[],
): PartyReportGroup[] {
  const dueByParty = new Map(
    dues.map((due) => [
      `${due.partyKind}:${due.partyId}:${due.branchId ?? due.branchName}`,
      due.currentDue,
    ]),
  );
  const groups = new Map<string, PartyReportGroup>();
  for (const event of events) {
    const bucket = periodKey(event.date, period);
    const partyBranch = event.branchId ?? event.branchName;
    const id = `${bucket}:${event.partyKind}:${event.partyId}:${partyBranch}`;
    let group = groups.get(id);
    if (!group) {
      group = {
        period: bucket,
        partyId: event.partyId,
        partyName: event.partyName,
        partyKind: event.partyKind,
        branchName: event.branchName,
        ...(event.branchId === undefined ? {} : { branchId: event.branchId }),
        sales: 0,
        paymentsIn: 0,
        salesReturns: 0,
        refundsOut: 0,
        purchases: 0,
        paymentsOut: 0,
        purchaseReturns: 0,
        refundsIn: 0,
        currentDue: dueByParty.get(`${event.partyKind}:${event.partyId}:${partyBranch}`) ?? 0,
      };
      groups.set(id, group);
    }
    switch (event.eventKind) {
      case "sale":
        group.sales += event.amount;
        break;
      case "payment_in":
        group.paymentsIn += event.amount;
        break;
      case "sales_return":
        group.salesReturns += event.amount;
        break;
      case "refund_out":
        group.refundsOut += event.amount;
        break;
      case "purchase":
        group.purchases += event.amount;
        break;
      case "payment_out":
        group.paymentsOut += event.amount;
        break;
      case "purchase_return":
        group.purchaseReturns += event.amount;
        break;
      case "refund_in":
        group.refundsIn += event.amount;
        break;
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.period.localeCompare(a.period) ||
      a.partyName.localeCompare(b.partyName) ||
      a.branchName.localeCompare(b.branchName),
  );
}

export function outstandingDues(dues: PartyDueRow[], dueOnly: boolean): PartyDueRow[] {
  return dues
    .filter((row) => !dueOnly || row.currentDue > 0)
    .sort((a, b) => b.currentDue - a.currentDue || a.partyName.localeCompare(b.partyName));
}

export function selectReportColumns(
  available: readonly ReportColumn[],
  selected: readonly string[],
): ReportColumn[] {
  return available.filter(([key]) => selected.includes(key));
}
