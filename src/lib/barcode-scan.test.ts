import { describe, expect, it } from "vitest";
import {
  imeiCandidatesFromBarcode,
  isValidImei,
  splitCodes,
  validImeiCandidatesFromBarcode,
} from "./barcode";

function imeiWithPrefix(prefix: string) {
  const body = `${prefix}${"0".repeat(12)}`;
  for (let checkDigit = 0; checkDigit <= 9; checkDigit++) {
    const imei = `${body}${checkDigit}`;
    if (isValidImei(imei)) return imei;
  }
  throw new Error("Could not create a valid test IMEI.");
}

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

  it("validates the 15-digit IMEI check digit", () => {
    expect(isValidImei("490154203237518")).toBe(true);
    expect(isValidImei("490154203237519")).toBe(false);
    expect(isValidImei("49015420323751")).toBe(false);
    expect(isValidImei("49015420323751A")).toBe(false);
  });

  it.each(["56", "85", "88", "87"])("detects a valid 15-digit IMEI beginning with %s", (prefix) => {
    const imei = imeiWithPrefix(prefix);
    expect(imei).toHaveLength(15);
    expect(validImeiCandidatesFromBarcode(`IMEI ${imei}`)).toEqual([imei]);
  });

  it("does not accept an invalid 15-digit code as an IMEI", () => {
    expect(validImeiCandidatesFromBarcode("560000000000008")).toEqual([]);
  });
});
