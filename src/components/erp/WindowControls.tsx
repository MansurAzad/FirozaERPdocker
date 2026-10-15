import { useEffect, useState } from "react";
import { Minus, Copy, X, Maximize2 } from "lucide-react";
import { toast } from "sonner";

const OPT_OUT = "firoza.fs.off";
const isFs = () => Boolean(document.fullscreenElement);
const enter = () => document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
const exit = () => (isFs() ? document.exitFullscreen().catch(() => {}) : Promise.resolve());

/**
 * Browsers only allow fullscreen after a user gesture, so the app enters fullscreen on the
 * first click/key press of a session (unless the user chose Restore/Minimize), and shows
 * Windows-style controls at the top-right while fullscreen.
 */
export function WindowControls() {
  const [fs, setFs] = useState(false);
  useEffect(() => {
    let was = isFs();
    const sync = () => {
      // Leaving fullscreen by any route (Esc, F11, header button) counts as the user's choice.
      if (was && !isFs()) sessionStorage.setItem(OPT_OUT, "1");
      was = isFs();
      setFs(isFs());
      document.documentElement.toggleAttribute("data-fs", isFs());
    };
    const auto = () => {
      if (!isFs() && sessionStorage.getItem(OPT_OUT) !== "1") enter();
    };
    document.addEventListener("fullscreenchange", sync);
    window.addEventListener("pointerdown", auto, true);
    window.addEventListener("keydown", auto, true);
    sync();
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      window.removeEventListener("pointerdown", auto, true);
      window.removeEventListener("keydown", auto, true);
    };
  }, []);

  const optOut = () => sessionStorage.setItem(OPT_OUT, "1");
  const btn = "grid h-8 w-11 place-items-center text-sidebar-foreground transition-colors hover:bg-sidebar-accent";

  if (!fs)
    return (
      <button
        type="button"
        aria-label="Enter full screen"
        title="Full screen"
        onClick={(e) => { e.stopPropagation(); sessionStorage.removeItem(OPT_OUT); enter(); }}
        className="fixed bottom-3 right-3 z-[60] grid size-9 place-items-center rounded-md bg-sidebar text-sidebar-foreground shadow-lg print:hidden"
      >
        <Maximize2 className="size-4" />
      </button>
    );

  return (
    <div className="fixed right-0 top-0 z-[60] flex overflow-hidden rounded-bl-md bg-sidebar shadow print:hidden" onPointerDownCapture={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Minimize" title="Minimize" className={btn}
        onClick={() => {
          optOut();
          exit().then(() => toast.info("ব্রাউজার উইন্ডো মিনিমাইজ করতে টাস্কবারে ক্লিক করুন বা Win+↓ চাপুন।"));
        }}>
        <Minus className="size-4" />
      </button>
      <button type="button" aria-label="Restore" title="Restore down" className={btn}
        onClick={() => { optOut(); exit(); }}>
        <Copy className="size-3.5" />
      </button>
      <button type="button" aria-label="Close" title="Close" className={btn + " hover:bg-destructive hover:text-destructive-foreground"}
        onClick={() => {
          optOut();
          exit().then(() => {
            window.close();
            setTimeout(() => {
              if (!window.closed)
                toast.info("ব্রাউজার এই ট্যাবটি বন্ধ করতে দিচ্ছে না — Ctrl+W চাপুন বা ট্যাবের × এ ক্লিক করুন।");
            }, 300);
          });
        }}>
        <X className="size-4" />
      </button>
    </div>
  );
}
