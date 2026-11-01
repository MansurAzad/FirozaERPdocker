import { useEffect, useRef, useState, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { bdt } from "@/lib/format";

export const selectCls = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

export function F({
  label,
  children,
  className,
  optional = false,
  initiallyEnabled = false,
}: {
  label: string;
  children: ReactNode;
  className?: string | undefined;
  optional?: boolean;
  initiallyEnabled?: boolean;
}) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const lastTouch = useRef(0);
  useEffect(() => {
    if (initiallyEnabled) setEnabled(true);
  }, [initiallyEnabled]);
  const collapsed = optional && !enabled;
  return (
    <div className={collapsed ? "contents" : "space-y-1.5 " + (className ?? "")}>
      {collapsed ? (
        <button
          type="button"
          className="w-fit rounded-sm text-left text-xs font-semibold text-emerald-700 outline-none hover:text-emerald-800 focus-visible:ring-2 focus-visible:ring-ring dark:text-emerald-400 dark:hover:text-emerald-300"
          aria-label={label}
          onDoubleClick={() => setEnabled(true)}
          onTouchEnd={(event) => {
            event.preventDefault();
            const now = Date.now();
            if (now - lastTouch.current < 400) {
              setEnabled(true);
              lastTouch.current = 0;
            } else {
              lastTouch.current = now;
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") setEnabled(true);
          }}
        >
          {label}
        </button>
      ) : (
        <>
          <Label className="text-xs">{label}</Label>
          {children}
        </>
      )}
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
    <div className="min-w-0 bg-card p-3 sm:p-5">
      <div className="break-words text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={
          "num mt-2 break-words font-display text-xl font-semibold leading-tight sm:text-2xl " +
          (tone === "neg" ? "text-destructive" : tone === "pos" ? "text-success" : "")
        }
      >
        {bdt(value)}
      </div>
      {note && <div className="mt-1 break-words text-xs text-muted-foreground">{note}</div>}
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
