const DHAKA_TIME_ZONE = "Asia/Dhaka";

export function dhakaDate(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DHAKA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new Error("Could not determine the Dhaka calendar date.");
  return `${year}-${month}-${day}`;
}

export function lastDhakaDays(n: number, now: Date = new Date()) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("Day count must be a positive integer.");
  const [year, month, day] = dhakaDate(now).split("-").map(Number);
  const today = new Date(Date.UTC(year!, month! - 1, day!));
  const labelFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
  });
  const days: { date: string; label: string }[] = [];
  for (let offset = n - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - offset);
    days.push({
      date: date.toISOString().slice(0, 10),
      label: labelFormat.format(date),
    });
  }
  return days;
}
