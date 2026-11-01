import { useEffect, useRef, useState } from "react";
import { Camera, QrCode, X, ZoomIn, Zap } from "lucide-react";
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
import { splitCodes, validImeiCandidatesFromBarcode } from "@/lib/barcode";

type Props = {
  onCodes: (codes: string[]) => void;
  onValidation?: (result: { valid: boolean; value: string; message: string }) => void;
  multi?: boolean;
  label?: string;
  size?: "sm" | "default" | "icon";
  vibrateSuccess?: boolean;
  validateImei?: boolean;
};

type ZoomCapabilities = MediaTrackCapabilities & {
  zoom?: { min: number; max: number; step?: number };
  torch?: boolean;
  focusMode?: string[];
};

type ZoomSettings = MediaTrackSettings & { zoom?: number };
type AdvancedCameraConstraint = MediaTrackConstraintSet & {
  focusMode?: string;
  torch?: boolean;
  zoom?: ConstrainDouble;
};

/** Camera barcode / QR scanner. Multi mode keeps scanning and collects a bulk list. */
export function ScanButton({
  onCodes,
  onValidation,
  multi = true,
  label,
  size = "icon",
  vibrateSuccess = true,
  validateImei = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [paste, setPaste] = useState("");
  const [err, setErr] = useState("");
  const [starting, setStarting] = useState(false);
  const [retry, setRetry] = useState(0);
  const [feedback, setFeedback] = useState<{ valid: boolean; message: string } | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoom, setZoom] = useState<{
    min: number;
    max: number;
    step: number;
    value: number;
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanner = useRef<IScannerControls | null>(null);
  const videoTrack = useRef<MediaStreamTrack | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const last = useRef("");
  const cb = useRef(onCodes);
  cb.current = onCodes;
  const validationCb = useRef(onValidation);
  validationCb.current = onValidation;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let mountTimer: number | undefined;
    setErr("");
    setFeedback(null);
    setStarting(true);
    setZoom(null);
    setTorchSupported(false);
    setTorchOn(false);
    setCameras([]);
    videoTrack.current = null;
    last.current = "";
    (async () => {
      try {
        if (!window.isSecureContext) {
          throw new Error(
            "Camera access requires HTTPS or localhost. Use a USB scanner or paste codes below.",
          );
        }
        if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
          throw new Error(
            "Camera access is unavailable in this browser. Use a USB scanner or paste codes below.",
          );
        }
        const video =
          videoRef.current ??
          (await new Promise<HTMLVideoElement | null>((resolve) => {
            let attempts = 0;
            const findPreview = () => {
              const mountedVideo = videoRef.current;
              if (!alive || mountedVideo || attempts >= 20) {
                resolve(mountedVideo);
                return;
              }
              attempts += 1;
              mountTimer = window.setTimeout(findPreview, 50);
            };
            findPreview();
          }));
        if (!alive) return;
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
              BarcodeFormat.UPC_EAN_EXTENSION,
              BarcodeFormat.QR_CODE,
              BarcodeFormat.DATA_MATRIX,
              BarcodeFormat.PDF_417,
              BarcodeFormat.AZTEC,
              BarcodeFormat.CODABAR,
              BarcodeFormat.RSS_14,
              BarcodeFormat.RSS_EXPANDED,
            ],
          ],
          [DecodeHintType.TRY_HARDER, true],
        ]);
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 120,
          delayBetweenScanSuccess: 450,
        });
        const handleResult = (
          result: { getText: () => string } | undefined,
          _error: unknown,
          activeControls: IScannerControls,
        ) => {
          if (!alive || !result) return;
          scanner.current = activeControls;
          const code = result.getText().trim();
          if (!code || code === last.current) return;
          last.current = code;
          setTimeout(() => {
            if (last.current === code) last.current = "";
          }, 1500);
          setErr("");
          const scannedCodes = validateImei ? validImeiCandidatesFromBarcode(code) : [code];
          if (validateImei && scannedCodes.length === 0) {
            const message = "Invalid IMEI. Check the 15 digits and check digit, then scan again.";
            setFeedback({
              valid: false,
              message,
            });
            validationCb.current?.({ valid: false, value: code, message });
            navigator.vibrate?.([120, 50, 120]);
            return;
          }
          if (validateImei) {
            validationCb.current?.({
              valid: true,
              value: scannedCodes[0]!,
              message: "IMEI is valid.",
            });
            setFeedback({ valid: true, message: "IMEI is valid." });
            void playSuccessBeep()
              .then((played) => {
                if (!played && alive) {
                  setFeedback({
                    valid: true,
                    message: "IMEI is valid. Audio feedback is unavailable.",
                  });
                }
              })
              .catch(() => {
                if (alive) {
                  setFeedback({
                    valid: true,
                    message: "IMEI is valid. Audio feedback is unavailable.",
                  });
                }
              });
          } else if (vibrateSuccess) {
            navigator.vibrate?.(60);
          }
          if (!multi) {
            cb.current(scannedCodes);
            activeControls.stop();
            if (validateImei) window.setTimeout(() => setOpen(false), 650);
            else setOpen(false);
            return;
          }
          setCodes((current) => [
            ...current,
            ...scannedCodes.filter((scannedCode) => !current.includes(scannedCode)),
          ]);
        };
        const requestedVideo = cameraId
          ? {
              deviceId: { exact: cameraId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            };
        const constraints: MediaStreamConstraints[] = [
          { audio: false, video: requestedVideo },
          ...(cameraId ? [{ audio: false, video: { facingMode: { ideal: "environment" } } }] : []),
          { audio: false, video: true },
        ];
        let controls: IScannerControls | undefined;
        let cameraError: unknown;
        for (const constraint of constraints) {
          try {
            controls = await reader.decodeFromConstraints(constraint, video, handleResult);
            break;
          } catch (error) {
            cameraError = error;
            const name =
              error && typeof error === "object" && "name" in error ? String(error.name) : "";
            if (name === "NotAllowedError" || name === "SecurityError") throw error;
          }
        }
        if (!controls) throw cameraError ?? new Error("The camera could not be started.");
        if (alive) {
          scanner.current = controls;
          setStarting(false);
          const stream = video.srcObject;
          const track =
            stream && typeof (stream as MediaStream).getVideoTracks === "function"
              ? (stream as MediaStream).getVideoTracks()[0]
              : undefined;
          let capabilities: ZoomCapabilities | undefined;
          try {
            capabilities = track?.getCapabilities?.() as ZoomCapabilities | undefined;
          } catch (error) {
            setErr(
              error instanceof Error
                ? `Scanner is active, but camera controls are unavailable: ${error.message}`
                : "Scanner is active, but camera controls are unavailable.",
            );
          }
          videoTrack.current = track ?? null;
          setTorchSupported(capabilities?.torch === true);
          if (track && capabilities?.focusMode?.includes("continuous")) {
            const focus: AdvancedCameraConstraint = { focusMode: "continuous" };
            void track.applyConstraints({ advanced: [focus] }).catch((error: unknown) => {
              if (alive)
                setErr(
                  error instanceof Error
                    ? `Could not enable continuous autofocus: ${error.message}`
                    : "Could not enable continuous autofocus.",
                );
            });
          }
          if (typeof navigator.mediaDevices?.enumerateDevices === "function") {
            void navigator.mediaDevices
              .enumerateDevices()
              .then((devices) => {
                if (alive) setCameras(devices.filter((device) => device.kind === "videoinput"));
              })
              .catch((error: unknown) => {
                if (alive)
                  setErr(
                    error instanceof Error
                      ? `Scanner is active, but available cameras could not be listed: ${error.message}`
                      : "Scanner is active, but available cameras could not be listed.",
                  );
              });
          }
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
          const name =
            error && typeof error === "object" && "name" in error ? String(error.name) : "";
          setErr(
            name === "NotAllowedError"
              ? "Camera access is blocked. Allow camera permission and try again."
              : name === "NotFoundError"
                ? "No camera was found. Use a USB scanner or paste codes below."
                : name === "NotReadableError"
                  ? "The camera is already in use by another app. Close it and try again."
                  : error instanceof Error
                    ? `Could not start the camera: ${error.message}`
                    : "Could not start the camera. Check camera permission and try again.",
          );
          setStarting(false);
        }
      }
    })();
    return () => {
      alive = false;
      if (mountTimer !== undefined) window.clearTimeout(mountTimer);
      const activeScanner = scanner.current;
      scanner.current = null;
      videoTrack.current = null;
      activeScanner?.stop();
    };
  }, [open, multi, vibrateSuccess, validateImei, cameraId, retry]);

  function prepareScanAudio() {
    if (!validateImei || typeof window.AudioContext !== "function") return;
    try {
      audioContext.current ??= new window.AudioContext();
      if (audioContext.current.state === "suspended") {
        void audioContext.current.resume().catch(() => {});
      }
    } catch {
      audioContext.current = null;
    }
  }

  async function playSuccessBeep() {
    const context = audioContext.current;
    if (!context || context.state === "closed") return false;
    await context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.17);
    return true;
  }

  function applyZoom(value: number) {
    const track = videoTrack.current;
    if (!track) return;
    const zoomConstraint: AdvancedCameraConstraint = { zoom: { ideal: value } };
    void track.applyConstraints({ advanced: [zoomConstraint] }).catch((error: unknown) => {
      setErr(
        error instanceof Error
          ? `Could not adjust camera zoom: ${error.message}`
          : "Could not adjust camera zoom.",
      );
    });
  }

  async function toggleTorch() {
    const track = videoTrack.current;
    if (!track) return;
    const next = !torchOn;
    const torchConstraint: AdvancedCameraConstraint = { torch: next };
    try {
      await track.applyConstraints({ advanced: [torchConstraint] });
      setTorchOn(next);
      setErr("");
    } catch (error) {
      setErr(
        error instanceof Error
          ? `Could not change flashlight: ${error.message}`
          : "Could not change flashlight.",
      );
    }
  }

  function finish() {
    const all = [...new Set([...codes, ...splitCodes(paste)])];
    const valid = validateImei ? all.flatMap(validImeiCandidatesFromBarcode) : all;
    const invalid = validateImei
      ? all.filter((code) => validImeiCandidatesFromBarcode(code).length === 0)
      : [];
    if (valid.length) {
      if (validateImei) {
        for (const value of valid) {
          validationCb.current?.({ valid: true, value, message: "IMEI is valid." });
        }
      }
      onCodes([...new Set(valid)]);
      if (validateImei) {
        setFeedback({ valid: true, message: "IMEI is valid." });
        void playSuccessBeep()
          .then((played) => {
            if (!played) {
              setFeedback({
                valid: true,
                message: "IMEI is valid. Audio feedback is unavailable.",
              });
            }
          })
          .catch(() => {
            setFeedback({ valid: true, message: "IMEI is valid. Audio feedback is unavailable." });
          });
      }
    }
    if (invalid.length) {
      for (const value of invalid) {
        validationCb.current?.({
          valid: false,
          value,
          message: "Invalid IMEI. Check the 15 digits and check digit.",
        });
      }
      setFeedback({
        valid: false,
        message: `${invalid.length} invalid IMEI(s). Check the 15 digits and check digit.`,
      });
      navigator.vibrate?.([120, 50, 120]);
    }
    setCodes([]);
    if (!invalid.length) setPaste("");
    if (!validateImei || !invalid.length) {
      if (validateImei && valid.length) window.setTimeout(() => setOpen(false), 650);
      else setOpen(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={() => {
          prepareScanAudio();
          setOpen(true);
        }}
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
          {(cameras.length > 1 || torchSupported) && (
            <div className="flex flex-wrap items-center gap-2">
              {cameras.length > 1 && (
                <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
                  Camera
                  <select
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-foreground"
                    value={cameraId}
                    onChange={(event) => setCameraId(event.target.value)}
                  >
                    <option value="">Default rear camera</option>
                    {cameras.map((camera, index) => (
                      <option key={camera.deviceId} value={camera.deviceId}>
                        {camera.label || `Camera ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {torchSupported && (
                <Button
                  type="button"
                  size="sm"
                  variant={torchOn ? "default" : "outline"}
                  onClick={() => void toggleTorch()}
                >
                  <Zap />
                  {torchOn ? "Turn flashlight off" : "Turn flashlight on"}
                </Button>
              )}
            </div>
          )}
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
          {feedback && (
            <p
              role="status"
              className={`rounded-md border px-3 py-2 text-sm ${
                feedback.valid
                  ? "border-green-600/40 bg-green-500/10 text-green-700 dark:text-green-400"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
            >
              {feedback.message}
            </p>
          )}
          {(multi || err) && (
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
                placeholder={
                  multi
                    ? "Or paste many codes (one per line, or from a USB scanner)"
                    : "Paste or scan a code with a USB scanner"
                }
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
              />
            </>
          )}
          {err && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setRetry((current) => current + 1)}
            >
              Try camera again
            </Button>
          )}
          {(multi || err) && (
            <DialogFooter>
              <span className="mr-auto self-center text-xs text-muted-foreground">
                {codes.length + splitCodes(paste).length} code(s)
              </span>
              <Button
                type="button"
                onClick={finish}
                disabled={!codes.length && !splitCodes(paste).length}
              >
                {multi ? "Add all" : "Use code"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
