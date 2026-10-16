import { useEffect, useRef, useState } from "react";
import { Camera, QrCode, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

/** Split pasted/scanned text into unique codes (lines, commas, spaces). */
export function splitCodes(text: string) {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

type Props = {
  onCodes: (codes: string[]) => void;
  multi?: boolean;
  label?: string;
  size?: "sm" | "default" | "icon";
};

/** Camera barcode / QR scanner. Multi mode keeps scanning and collects a bulk list. */
export function ScanButton({ onCodes, multi = true, label, size = "icon" }: Props) {
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [paste, setPaste] = useState("");
  const [err, setErr] = useState("");
  const boxId = useRef(`scan-${Math.random().toString(36).slice(2)}`).current;
  const scanner = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const last = useRef("");
  const cb = useRef(onCodes);
  cb.current = onCodes;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setErr("");
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        await new Promise((r) => setTimeout(r, 150));
        if (!alive) return;
        const s = new Html5Qrcode(boxId);
        scanner.current = s as never;
        await s.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 140 } },
          (text) => {
            const code = text.trim();
            if (!code || code === last.current) return;
            last.current = code;
            setTimeout(() => {
              if (last.current === code) last.current = "";
            }, 1500);
            navigator.vibrate?.(60);
            if (!multi) {
              cb.current([code]);
              setOpen(false);
              return;
            }
            setCodes((c) => (c.includes(code) ? c : [...c, code]));
          },
          () => {},
        );
      } catch {
        if (alive) setErr("Camera not available. Use a USB scanner or paste codes below.");
      }
    })();
    return () => {
      alive = false;
      const s = scanner.current;
      scanner.current = null;
      s?.stop()
        .then(() => s.clear())
        .catch(() => {});
    };
  }, [open, multi, boxId]);

  function finish() {
    const all = [...new Set([...codes, ...splitCodes(paste)])];
    if (all.length) onCodes(all);
    setCodes([]);
    setPaste("");
    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={() => setOpen(true)}
        title="Scan barcode / QR (camera or bulk paste)"
        aria-label="Scan barcode or QR"
      >
        <QrCode className="h-4 w-4" />
        {label && <span className="ml-1">{label}</span>}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setCodes([]);
            setPaste("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-4 w-4" />
              {multi ? "Bulk barcode / IMEI scan" : "Scan barcode / QR"}
            </DialogTitle>
          </DialogHeader>
          <div id={boxId} className="min-h-[200px] overflow-hidden rounded-md bg-muted" />
          {err && <p className="text-xs text-destructive">{err}</p>}
          {multi && (
            <>
              <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                {codes.map((c) => (
                  <Badge key={c} variant="secondary" className="gap-1 font-mono text-[11px]">
                    {c}
                    <button
                      type="button"
                      onClick={() => setCodes(codes.filter((x) => x !== c))}
                      aria-label="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <Textarea
                rows={3}
                className="font-mono text-xs"
                placeholder="Or paste many codes (one per line, or from a USB scanner)"
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
              />
            </>
          )}
          {multi && (
            <DialogFooter>
              <span className="mr-auto self-center text-xs text-muted-foreground">
                {codes.length + splitCodes(paste).length} code(s)
              </span>
              <Button onClick={finish}>Add all</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
