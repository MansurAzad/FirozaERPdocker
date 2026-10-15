import { useEffect } from "react";

export const SHORTCUTS: { keys: string; label: string; to?: string }[] = [
  { keys: "Ctrl+K", label: "Menu & global search" },
  { keys: "F2", label: "New Sale (POS)", to: "/app/sales/new" },
  { keys: "F3", label: "IMEI Search", to: "/app/imei" },
  { keys: "F4", label: "New Purchase", to: "/app/purchases/new" },
  { keys: "F6", label: "Inventory / Stock", to: "/app/stock" },
  { keys: "F7", label: "Due Collection", to: "/app/due-collection" },
  { keys: "F8", label: "Expenses", to: "/app/expenses" },
  { keys: "F9", label: "Customers", to: "/app/customers" },
  { keys: "Alt+H", label: "Dashboard", to: "/app" },
  { keys: "Alt+P", label: "Products", to: "/app/products" },
  { keys: "Alt+L", label: "Party Ledger", to: "/app/ledger" },
  { keys: "Alt+R", label: "Reports", to: "/app/reports" },
  { keys: "Ctrl+B", label: "Show / hide sidebar" },
  { keys: "Ctrl+Shift+F", label: "Full screen on / off" },
  { keys: "/", label: "Jump to search box on page" },
  { keys: "Enter", label: "Next field in forms (last field saves)" },
  { keys: "Shift+Enter", label: "Previous field" },
  { keys: "Ctrl+Enter", label: "Save / submit form" },
  { keys: "Esc", label: "Close popup" },
  { keys: "F1", label: "Shortcuts & user guide", to: "/app/guide" },
];

export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

const FOCUSABLE = "input:not([type=hidden]):not([disabled]):not([readonly]),select:not([disabled]),textarea:not([disabled]),button[role=combobox]:not([disabled])";

function isTyping(el: Element | null) {
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);
}

/** Global shortcuts + Enter-to-next-field. */
export function useAppShortcuts(h: { navigate: (to: string) => void; palette: () => void; sidebar: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      const k = e.key;
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "k") { e.preventDefault(); h.palette(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && k.toLowerCase() === "b") { e.preventDefault(); h.sidebar(); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && k.toLowerCase() === "f") { e.preventDefault(); toggleFullscreen(); return; }
      if (k === "F1") { e.preventDefault(); h.navigate("/app/guide"); return; }
      const fn = SHORTCUTS.find((s) => s.to && (s.keys === k || (e.altKey && s.keys === `Alt+${k.toUpperCase()}`)));
      if (fn && (k.startsWith("F") || e.altKey) && !e.ctrlKey) { e.preventDefault(); h.navigate(fn.to!); return; }
      if (k === "/" && !isTyping(t)) {
        const box = document.querySelector<HTMLInputElement>("main input[type=search], main input[placeholder*='earch'], main input[placeholder*='IMEI']");
        if (box) { e.preventDefault(); box.focus(); box.select(); }
        return;
      }
      if (k !== "Enter" || e.defaultPrevented || e.altKey || t.closest("[data-no-enter-nav]")) return;
      const form = t.closest("form");
      if (!form || !(t.tagName === "INPUT" || t.tagName === "SELECT" || t.getAttribute("role") === "combobox")) return;
      const type = (t as HTMLInputElement).type;
      if (["submit", "button", "checkbox", "radio", "file"].includes(type)) return;
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); form.requestSubmit(); return; }
      const fields = [...form.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (fields.length <= 1) return; // single scan/search box: Enter submits
      const i = fields.indexOf(t);
      if (i < 0) return;
      const next = fields[e.shiftKey ? i - 1 : i + 1];
      if (!next) return; // last field: let Enter submit
      e.preventDefault();
      next.focus();
      if (next instanceof HTMLInputElement) next.select?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [h]);
}
