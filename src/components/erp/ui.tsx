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
  return (
    <div className={"space-y-1.5 " + (className ?? "")}>
      <Label className="text-xs">
        {label}
        {optional && (
          <span className="ml-1 font-normal text-muted-foreground">
            · Optional{enabled ? "" : " · double-click/tap to enable"}
          </span>
        )}
      </Label>
      {optional ? (
        <div className="relative min-w-0">
          <fieldset
            disabled={!enabled}
            className={`m-0 min-w-0 border-0 p-0 ${enabled ? "" : "opacity-40"}`}
          >
            {children}
          </fieldset>
          {!enabled && (
            <button
              type="button"
              className="absolute inset-0 z-10 rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Enable optional ${label} field`}
              onDoubleClick={() => setEnabled(true)}
              onTouchEnd={(event) => {
                event.preventDefault();
                const now = Date.now();
                if (now - lastTouch.current < 400) setEnabled(true);
                lastTouch.current = now;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") setEnabled(true);
              }}
            >
              {enabled ? "" : "Double-click or double-tap to enter"}
            </button>
          )}
        </div>
      ) : (
        children
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
