import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { makeDataXlsx } from "./export";

describe("Excel data workbooks", () => {
  it("writes import-compatible headers followed by the complete dataset", async () => {
    const blob = await makeDataXlsx(
      ["Name", "Mobile", "Credit limit"],
      [["Ayesha Traders", "01712345678", 1250]],
    );
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Data"]!, {
      header: 1,
      raw: false,
    });

    expect(rows).toEqual([
      ["Name", "Mobile", "Credit limit"],
      ["Ayesha Traders", "01712345678", "1250"],
    ]);
  });
});
