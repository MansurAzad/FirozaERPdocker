import { useEffect, useRef, useState } from "react";
import { Camera, QrCode, X, ZoomIn } from "lucide-react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
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
import { Slider } from "@/components/ui/slider";

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
  vibrateSuccess?: boolean;
};

type ZoomCapabilities = MediaTrackCapabilities & {
  zoom?: { min: number; max: number; step?: number };
};

type ZoomSettings = MediaTrackSettings & { zoom?: number };
type ZoomConstraintSet = MediaTrackConstraintSet & { zoom?: ConstrainDouble };

/** Camera barcode / QR scanner. Multi mode keeps scanning and collects a bulk list. */
export function ScanButton({
  onCodes,
  multi = true,
  label,
  size = "icon",
  vibrateSuccess = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [paste, setPaste] = useState("");
  const [err, setErr] = useState("");
  const [starting, setStarting] = useState(false);
  const [zoom, setZoom] = useState<{
    min: number;
    max: number;
    step: number;
    value: number;
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanner = useRef<IScannerControls | null>(null);
  const zoomTrack = useRef<MediaStreamTrack | null>(null);
  const last = useRef("");
  const cb = useRef(onCodes);
  cb.current = onCodes;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setErr("");
    setStarting(true);
    setZoom(null);
    zoomTrack.current = null;
    last.current = "";
    (async () => {
      try {
        const video = videoRef.current;
        if (!video) {
          setErr("Camera preview could not be opened. Close this window and try again.");
          setStarting(false);
          return;
        }

        const hints = new Map<DecodeHintType, unknown>([
          [
            DecodeHintType.POSSIBLE_FORMATS,
            [
              BarcodeFormat.CODE_128,
              BarcodeFormat.CODE_39,
              BarcodeFormat.CODE_93,
              BarcodeFormat.EAN_13,
              BarcodeFormat.EAN_8,
              BarcodeFormat.ITF,
              BarcodeFormat.UPC_A,
              BarcodeFormat.UPC_E,
              BarcodeFormat.QR_CODE,
              BarcodeFormat.DATA_MATRIX,
              BarcodeFormat.PDF_417,
            ],
          ],
          [DecodeHintType.TRY_HARDER, true],
        ]);
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 120,
          delayBetweenScanSuccess: 450,
        });
        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          },
          video,
          (result, _error, activeControls) => {
            if (!alive || !result) return;
            scanner.current = activeControls;
            const code = result.getText().trim();
            if (!code || code === last.current) return;
            last.current = code;
            setTimeout(() => {
              if (last.current === code) last.current = "";
            }, 1500);
            if (vibrateSuccess) navigator.vibrate?.(60);
            if (!multi) {
              cb.current([code]);
              activeControls.stop();
              setOpen(false);
              return;
            }
            setCodes((c) => (c.includes(code) ? c : [...c, code]));
          },
        );
        if (alive) {
          scanner.current = controls;
          setStarting(false);
          const stream = video.srcObject;
          const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
          const capabilities = track?.getCapabilities() as ZoomCapabilities | undefined;
          const range = capabilities?.zoom;
          if (
            track &&
            range &&
            Number.isFinite(range.min) &&
            Number.isFinite(range.max) &&
            range.max > range.min
          ) {
            const settings = track.getSettings() as ZoomSettings;
            const step = range.step && range.step > 0 ? range.step : (range.max - range.min) / 40;
            zoomTrack.current = track;
            setZoom({
              min: range.min,
              max: range.max,
              step,
              value: settings.zoom ?? range.min,
            });
          }
        } else {
          controls.stop();
        }
      } catch (error) {
        if (alive) {
          const name = error instanceof DOMException ? error.name : "";
          setErr(
            name === "NotAllowedError"
              ? "Camera access is blocked. Allow camera permission and try again."
              : name === "NotFoundError"
                ? "No camera was found. Use a USB scanner or paste codes below."
                : "Could not start the camera. Check camera permission and try again.",
          );
          setStarting(false);
        }
      }
    })();
    return () => {
      alive = false;
      const activeScanner = scanner.current;
      scanner.current = null;
      zoomTrack.current = null;
      activeScanner?.stop();
    };
  }, [open, multi, vibrateSuccess]);

  function applyZoom(value: number) {
    const track = zoomTrack.current;
    if (!track) return;
    const zoomConstraint: ZoomConstraintSet = { zoom: { ideal: value } };
    void track.applyConstraints({ advanced: [zoomConstraint] }).catch((error: unknown) => {
      setErr(
        error instanceof Error
          ? `Could not adjust camera zoom: ${error.message}`
          : "Could not adjust camera zoom.",
      );
    });
  }

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
          <div className="relative overflow-hidden rounded-md bg-black">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="aspect-[4/3] max-h-[55vh] w-full object-contain"
            />
            <div className="pointer-events-none absolute inset-x-4 top-1/2 -translate-y-1/2">
              <div className="h-20 rounded-lg border-2 border-dashed border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.28)]" />
            </div>
          </div>
          {starting && <p className="text-xs text-muted-foreground">Starting camera…</p>}
          {!err && (
            <p className="text-xs text-muted-foreground">
              Center the barcode and move closer until it fills the guide.
            </p>
          )}
          {zoom && (
            <div className="flex items-center gap-3">
              <ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Slider
                aria-label="Camera zoom"
                min={zoom.min}
                max={zoom.max}
                step={zoom.step}
                value={[zoom.value]}
                onValueChange={([value]) => {
                  if (value !== undefined)
                    setZoom((current) => (current ? { ...current, value } : current));
                }}
                onValueCommit={([value]) => {
                  if (value !== undefined) applyZoom(value);
                }}
              />
              <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                {zoom.value.toFixed(1)}x
              </span>
            </div>
          )}
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
