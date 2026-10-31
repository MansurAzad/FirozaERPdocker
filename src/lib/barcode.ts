import { useEffect, useState } from "react";

// Barcode / QR rendering.
//
// The encoders (jsbarcode, qrcode) are imported lazily so the rest of the app
// never pays for them, and so a device that blocks the chunk simply falls back
// to printing the human-readable value instead of crashing the page.

export type BarcodeFormat = "CODE128" | "CODE39" | "EAN13" | "UPC";

export const BARCODE_FORMATS: BarcodeFormat[] = ["CODE128", "CODE39", "EAN13", "UPC"];

export function splitCodes(text: string) {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

export function imeiCandidatesFromBarcode(value: string): string[] {
  const candidates = new Set<string>();
  const text = value.split(String.fromCharCode(29)).join(" ");
  const matches = text.matchAll(/(?:^|[^\d])(\d{15})(?!\d)/g);

  for (const match of matches) {
    candidates.add(match[1]!);
  }

  for (const run of text.match(/\d+/g) ?? []) {
    if (run.length === 15) candidates.add(run);
    else if (run.length > 15) {
      for (let index = 0; index <= run.length - 15; index++) {
        candidates.add(run.slice(index, index + 15));
      }
    }
  }

  const compact = text.replace(/\D/g, "");
  if (compact.length === 15) candidates.add(compact);

  return [...candidates];
}

export async function barcodeSvg(
  value: string,
  format: BarcodeFormat = "CODE128",
): Promise<string> {
  const { default: JsBarcode } = await import("jsbarcode");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, value, {
    format,
    displayValue: false,
    margin: 0,
    height: 32,
    width: 1.4,
    background: "#ffffff",
    lineColor: "#000000",
  });
  return svg.outerHTML;
}

export async function qrSvg(value: string): Promise<string> {
  const QR = await import("qrcode");
  return QR.toString(value, {
    type: "svg",
    margin: 1,
    width: 96,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/** Renders a barcode (as raw SVG markup) for any value, with a safe fallback. */
export function useBarcode(value: string, format: BarcodeFormat, enabled = true) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setFailed(false);
    barcodeSvg(value, format)
      .then((s) => {
        if (alive) setSvg(s);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [value, format, enabled]);
  return { svg, failed };
}

/** Renders a QR code (as raw SVG markup) for any value, with a safe fallback. */
export function useQr(value: string, enabled = true) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setFailed(false);
    qrSvg(value)
      .then((s) => {
        if (alive) setSvg(s);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [value, enabled]);
  return { svg, failed };
}
