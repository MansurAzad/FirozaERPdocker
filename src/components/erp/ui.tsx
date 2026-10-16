import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { bdt } from "@/lib/format";

export const selectCls = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

export function F({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={"space-y-1.5 " + (className ?? "")}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: number;
  note?: string | undefined;
  tone?: "pos" | "neg" | undefined;
}) {
  return (
    <div className="bg-card p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={
          "num mt-2 font-display text-2xl font-semibold " +
          (tone === "neg" ? "text-destructive" : tone === "pos" ? "text-success" : "")
        }
      >
        {bdt(value)}
      </div>
      {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

export const METHODS = [
  "cash",
  "bank",
  "bkash",
  "nagad",
  "rocket",
  "card",
  "cheque",
  "other",
] as const;
export type Method = (typeof METHODS)[number];
export const methodLabel = (m: string) =>
  m === "bkash" ? "bKash" : m[0]!.toUpperCase() + m.slice(1);
export const today = () => new Date().toISOString().slice(0, 10);
export const monthStart = () => today().slice(0, 8) + "01";
export const KIND_LABEL: Record<string, string> = {
  cash: "Cash",
  bank: "Bank",
  mfs: "Mobile Banking",
};
