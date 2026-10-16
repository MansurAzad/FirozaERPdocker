import { useEffect, useRef, useState } from "react";
import { Minus, Copy, X, Maximize2 } from "lucide-react";
import { toast } from "sonner";

const isFs = () => Boolean(document.fullscreenElement);
const enter = () =>
  document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
const exit = () => (isFs() ? document.exitFullscreen().catch(() => {}) : Promise.resolve());

export function WindowControls() {
  const [fs, setFs] = useState(false);
  const taps = useRef<{ at: number; x: number; y: number }[]>([]);
  useEffect(() => {
    const sync = () => {
      setFs(isFs());
      document.documentElement.toggleAttribute("data-fs", isFs());
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || window.matchMedia("(min-width: 768px)").matches) return;
      if (
        event.target instanceof Element &&
        event.target.closest("a,button,input,select,textarea,[role='button']")
      ) {
        taps.current = [];
        return;
      }
      const now = Date.now();
      const previous = taps.current.at(-1);
      if (
        !previous ||
        now - previous.at > 700 ||
        Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > 48
      ) {
        taps.current = [];
      }
      taps.current.push({ at: now, x: event.clientX, y: event.clientY });
      if (taps.current.length < 3) return;
      taps.current = [];
      if (isFs()) void exit();
      else void enter();
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("pointerdown", onPointerDown, true);
    sync();
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  const btn =
    "grid h-8 w-11 place-items-center text-sidebar-foreground transition-colors hover:bg-sidebar-accent";

  if (!fs)
    return (
      <button
        type="button"
        aria-label="Enter full screen"
        title="Full screen"
        onClick={(e) => {
          e.stopPropagation();
          enter();
        }}
        className="fixed bottom-3 right-3 z-[60] hidden size-9 place-items-center rounded-md bg-sidebar text-sidebar-foreground shadow-lg print:hidden md:grid"
      >
        <Maximize2 className="size-4" />
      </button>
    );

  return (
    <div
      className="fixed right-0 top-0 z-[60] hidden overflow-hidden rounded-bl-md bg-sidebar shadow print:hidden md:flex"
      onPointerDownCapture={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Minimize"
        title="Minimize"
        className={btn}
        onClick={() => {
          exit().then(() =>
            toast.info("ব্রাউজার উইন্ডো মিনিমাইজ করতে টাস্কবারে ক্লিক করুন বা Win+↓ চাপুন।"),
          );
        }}
      >
        <Minus className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Restore"
        title="Restore down"
        className={btn}
        onClick={() => {
          exit();
        }}
      >
        <Copy className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Close"
        title="Close"
        className={btn + " hover:bg-destructive hover:text-destructive-foreground"}
        onClick={() => {
          exit().then(() => {
            window.close();
            setTimeout(() => {
              if (!window.closed)
                toast.info(
                  "ব্রাউজার এই ট্যাবটি বন্ধ করতে দিচ্ছে না — Ctrl+W চাপুন বা ট্যাবের × এ ক্লিক করুন।",
                );
            }, 300);
          });
        }}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
