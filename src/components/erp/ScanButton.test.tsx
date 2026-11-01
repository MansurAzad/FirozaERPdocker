import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

const scannerMock = vi.hoisted(() => ({
  decode: vi.fn(),
  onResult: null as null | ((result: { getText: () => string } | undefined) => void),
  hints: null as unknown,
}));
const audioMock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  resume: vi.fn(),
}));

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    constructor(hints: unknown) {
      scannerMock.hints = hints;
    }

    decodeFromConstraints(
      constraints: MediaStreamConstraints,
      video: HTMLVideoElement,
      callback: (
        result: { getText: () => string } | undefined,
        error: unknown,
        controls: { stop: () => void },
      ) => void,
    ) {
      return scannerMock.decode(constraints, video).then((controls: { stop: () => void }) => {
        scannerMock.onResult = (result) => callback(result, undefined, controls);
        return controls;
      });
    }
  },
}));

import { ScanButton } from "./ScanButton";

const controls = { stop: vi.fn() };

beforeEach(() => {
  scannerMock.decode.mockReset();
  scannerMock.onResult = null;
  scannerMock.hints = null;
  controls.stop.mockReset();
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: {
      getUserMedia: vi.fn(),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
    vibrate: vi.fn(),
  });
  audioMock.start.mockReset();
  audioMock.stop.mockReset();
  audioMock.resume.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      currentTime = 0;
      destination = {};
      resume = audioMock.resume;
      createOscillator() {
        return {
          type: "",
          frequency: { value: 0 },
          connect: vi.fn(),
          start: audioMock.start,
          stop: audioMock.stop,
        };
      }
      createGain() {
        return {
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        };
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ScanButton camera scanning", () => {
  it("falls back to a compatible camera stream and delivers a scanned code", async () => {
    scannerMock.decode
      .mockRejectedValueOnce(
        Object.assign(new Error("Unsupported resolution"), { name: "OverconstrainedError" }),
      )
      .mockResolvedValueOnce(controls);
    const onCodes = vi.fn();
    render(<ScanButton multi={false} vibrateSuccess={false} onCodes={onCodes} />);

    fireEvent.click(screen.getByRole("button", { name: "Scan barcode or QR" }));
    await waitFor(() => expect(scannerMock.decode).toHaveBeenCalledTimes(2));
    expect(scannerMock.decode.mock.calls[0]?.[0]).toMatchObject({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    expect(scannerMock.decode.mock.calls[1]?.[0]).toEqual({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    scannerMock.onResult?.({ getText: () => "123456789012345" });
    expect(onCodes).toHaveBeenCalledWith(["123456789012345"]);
    expect(controls.stop).toHaveBeenCalled();
  });

  it("uses only IMEI-relevant formats to keep decoding focused", async () => {
    scannerMock.decode.mockResolvedValue(controls);
    render(<ScanButton multi={false} validateImei onCodes={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Scan barcode or QR" }));
    await waitFor(() => expect(scannerMock.onResult).not.toBeNull());

    const hints = scannerMock.hints as Map<unknown, unknown>;
    const formats = hints.get(DecodeHintType.POSSIBLE_FORMATS) as BarcodeFormat[];
    expect(formats).toContain(BarcodeFormat.CODE_128);
    expect(formats).toContain(BarcodeFormat.DATA_MATRIX);
    expect(formats).toContain(BarcodeFormat.QR_CODE);
    expect(formats).not.toContain(BarcodeFormat.RSS_14);
    expect(hints.get(DecodeHintType.TRY_HARDER)).toBe(true);
  });

  it("preserves the selected camera when falling back from high resolution", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: {
        getUserMedia: vi.fn(),
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: "videoinput", deviceId: "camera-1", label: "Front camera" },
          { kind: "videoinput", deviceId: "camera-2", label: "Rear camera" },
        ]),
      },
      vibrate: vi.fn(),
    });
    scannerMock.decode.mockResolvedValue(controls);
    render(<ScanButton multi={false} onCodes={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Scan barcode or QR" }));
    const selector = await screen.findByRole("combobox", { name: "Camera" });
    scannerMock.decode
      .mockRejectedValueOnce(
        Object.assign(new Error("Unsupported resolution"), { name: "OverconstrainedError" }),
      )
      .mockResolvedValueOnce(controls);
    scannerMock.decode.mockClear();

    fireEvent.change(selector, { target: { value: "camera-2" } });
    await waitFor(() => expect(scannerMock.decode).toHaveBeenCalledTimes(2));
    expect(scannerMock.decode.mock.calls[0]?.[0]).toMatchObject({
      video: { deviceId: { exact: "camera-2" }, width: { ideal: 1920 } },
    });
    expect(scannerMock.decode.mock.calls[1]?.[0]).toEqual({
      audio: false,
      video: { deviceId: { exact: "camera-2" } },
    });
  });

  it("offers a USB/paste fallback after camera startup fails in single-scan mode", async () => {
    scannerMock.decode.mockRejectedValue(new Error("Camera unavailable"));
    const onCodes = vi.fn();
    render(<ScanButton multi={false} vibrateSuccess={false} onCodes={onCodes} />);

    fireEvent.click(screen.getByRole("button", { name: "Scan barcode or QR" }));
    expect(
      await screen.findByText(/Could not start the camera: Camera unavailable/),
    ).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText("Paste or scan a code with a USB scanner");
    fireEvent.change(textarea, { target: { value: "manual-imei" } });
    fireEvent.click(screen.getByRole("button", { name: "Use code" }));

    expect(onCodes).toHaveBeenCalledWith(["manual-imei"]);
  });

  it("accepts valid IMEIs, beeps, and keeps the scan feedback green", async () => {
    scannerMock.decode.mockResolvedValue(controls);
    const onCodes = vi.fn();
    render(<ScanButton multi={false} validateImei onCodes={onCodes} />);

    fireEvent.click(screen.getByRole("button", { name: "Scan barcode or QR" }));
    await waitFor(() => expect(scannerMock.onResult).not.toBeNull());
    scannerMock.onResult?.({ getText: () => "IMEI: 490154203237518" });

    expect(onCodes).toHaveBeenCalledWith(["490154203237518"]);
    expect(await screen.findByRole("status")).toHaveTextContent("IMEI is valid.");
    await waitFor(() => expect(audioMock.start).toHaveBeenCalledOnce());
    expect(audioMock.stop).toHaveBeenCalledOnce();
    expect(navigator.vibrate).not.toHaveBeenCalled();
  });

  it("rejects an invalid IMEI, vibrates, and shows red validation feedback", async () => {
    scannerMock.decode.mockResolvedValue(controls);
    const onCodes = vi.fn();
    render(<ScanButton multi={false} validateImei onCodes={onCodes} />);

    fireEvent.click(screen.getByRole("button", { name: "Scan barcode or QR" }));
    await waitFor(() => expect(scannerMock.onResult).not.toBeNull());
    scannerMock.onResult?.({ getText: () => "490154203237519" });

    expect(onCodes).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent(/Invalid IMEI/);
    expect(screen.getByRole("status").className).toContain("text-destructive");
    expect(navigator.vibrate).toHaveBeenCalledWith([120, 50, 120]);
    expect(audioMock.start).not.toHaveBeenCalled();
  });
});
