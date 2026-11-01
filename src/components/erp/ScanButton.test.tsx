import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scannerMock = vi.hoisted(() => ({
  decode: vi.fn(),
  onResult: null as null | ((result: { getText: () => string } | undefined) => void),
}));

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
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
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
    });
    expect(scannerMock.decode.mock.calls[1]?.[0]).toEqual({ audio: false, video: true });

    scannerMock.onResult?.({ getText: () => "123456789012345" });
    expect(onCodes).toHaveBeenCalledWith(["123456789012345"]);
    expect(controls.stop).toHaveBeenCalled();
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
});
