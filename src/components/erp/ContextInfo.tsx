import type { ReactNode } from "react";

type ContextInfoItem = {
  label: string;
  value: ReactNode;
  tone?: "default" | "warning" | "danger";
};

export function ContextInfo({
  items,
  className = "",
}: {
  items: ContextInfoItem[];
  className?: string;
}) {
  return (
    <dl
      className={`grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 rounded-md border bg-muted/40 p-3 text-xs sm:grid-cols-3 ${className}`}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd
            className={`mt-0.5 break-words font-semibold tabular-nums ${
              item.tone === "danger"
                ? "text-destructive"
                : item.tone === "warning"
                  ? "text-amber-700 dark:text-amber-400"
                  : ""
            }`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
