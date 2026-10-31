import { describe, expect, it } from "vitest";
import { imeiCandidatesFromBarcode, splitCodes } from "./barcode";

describe("IMEI barcode parsing", () => {
  it("splits pasted scans and removes duplicate codes", () => {
    expect(splitCodes("123456789012345, 123456789012345\n543210987654321")).toEqual([
      "123456789012345",
      "543210987654321",
    ]);
  });

  it("extracts a plain IMEI and ignores surrounding text", () => {
    expect(imeiCandidatesFromBarcode("IMEI: 356789012345671")).toEqual(["356789012345671"]);
    expect(imeiCandidatesFromBarcode("356 789 012 345 671")).toContain("356789012345671");
  });

  it("handles GS1-separated barcode data and concatenated digits", () => {
    expect(imeiCandidatesFromBarcode("01 01234567890128 21 356789012345671")).toContain(
      "356789012345671",
    );
    expect(imeiCandidatesFromBarcode(`01${String.fromCharCode(29)}356789012345671`)).toEqual([
      "356789012345671",
    ]);
    expect(imeiCandidatesFromBarcode("0101234567890128356789012345671")).toContain(
      "356789012345671",
    );
  });

  it("returns no candidate for a code without a complete IMEI", () => {
    expect(imeiCandidatesFromBarcode("12345678901234")).toEqual([]);
    expect(imeiCandidatesFromBarcode("ABC-12345")).toEqual([]);
  });
});
