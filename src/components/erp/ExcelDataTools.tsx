import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Import, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { friendlyError } from "@/lib/format";
import { download, makeDataXlsx } from "@/lib/export";

export type ExcelValue = string | number | boolean | null | undefined;
export type ExcelRecord = Record<string, ExcelValue> & {
  address?: ExcelValue;
  account?: ExcelValue;
  alt_mobile?: ExcelValue;
  amount?: ExcelValue;
  available?: ExcelValue;
  brand?: ExcelValue;
  business_name?: ExcelValue;
  category?: ExcelValue;
  color?: ExcelValue;
  counted_qty?: ExcelValue;
  credit_limit?: ExcelValue;
  current_due?: ExcelValue;
  customer_mobile?: ExcelValue;
  dealer?: ExcelValue;
  dealer_discount?: ExcelValue;
  dealer_level?: ExcelValue;
  dealer_price?: ExcelValue;
  dealer_type?: ExcelValue;
  method?: ExcelValue;
  min_price?: ExcelValue;
  model?: ExcelValue;
  mobile?: ExcelValue;
  name?: ExcelValue;
  nid?: ExcelValue;
  notes?: ExcelValue;
  paid_on?: ExcelValue;
  payment_terms_days?: ExcelValue;
  price_level?: ExcelValue;
  purchase_price?: ExcelValue;
  ram?: ExcelValue;
  reorder_level?: ExcelValue;
  retail_price?: ExcelValue;
  sku?: ExcelValue;
  status?: ExcelValue;
  storage?: ExcelValue;
  trade_license?: ExcelValue;
  txn_ref?: ExcelValue;
  type?: ExcelValue;
  unit_cost?: ExcelValue;
  warranty_months?: ExcelValue;
  wholesale_price?: ExcelValue;
  branch?: ExcelValue;
  current_qty?: ExcelValue;
  product?: ExcelValue;
  reference?: ExcelValue;
};
export type ExcelColumn = {
  key: string;
  label: string;
  required?: boolean;
  type?: "text" | "number";
};
export type ExcelExport = {
  label: string;
  fileName: string;
  columns: ExcelColumn[];
  rows: ExcelRecord[];
};
export type ExcelImportResult = {
  imported: number;
  skipped?: number;
  errors?: string[];
};

type ExcelDataToolsProps = {
  exports: ExcelExport[];
  canExport: boolean;
  canImport?: boolean;
  importLabel?: string;
  importConfig?: {
    title: string;
    fileName: string;
    description?: string;
    columns: ExcelColumn[];
    validateRow?: (row: ExcelRecord, index: number) => string | null;
    onImport: (rows: ExcelRecord[]) => Promise<ExcelImportResult>;
  };
};

type PreviewRow = { row: ExcelRecord; line: number; error: string | null };
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;

export function ExcelDataTools({
  exports,
  canExport,
  canImport = false,
  importLabel = "Import Excel",
  importConfig,
}: ExcelDataToolsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [importCompleted, setImportCompleted] = useState(false);

  const template = async () => {
    if (!importConfig) return;
    try {
      const columns = importConfig.columns;
      const blob = await makeDataXlsx(
        columns.map((column) => column.label),
        [],
      );
      download(blob, `${importConfig.fileName}-template.xlsx`);
    } catch (error) {
      toast.error(friendlyError(error));
    }
  };

  const chooseFile = () => inputRef.current?.click();

  const readFile = async (file: File) => {
    setBusy(true);
    setFileName(file.name);
    setPreview([]);
    setImportCompleted(false);
    try {
      if (file.size > MAX_FILE_SIZE) throw new Error("Choose an Excel file smaller than 10 MB.");
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]!];
      if (!firstSheet) throw new Error("The workbook does not contain a worksheet.");
      const grid = XLSX.utils.sheet_to_json<ExcelValue[]>(firstSheet, {
        header: 1,
        defval: "",
        raw: false,
        blankrows: false,
      });
      const headers = (grid[0] ?? []).map((value) => String(value).trim().toLowerCase());
      const indexes = new Map<string, number>();
      for (const [index, header] of headers.entries()) {
        if (header && indexes.has(header)) throw new Error(`Duplicate column header: ${header}`);
        if (header) indexes.set(header, index);
      }
      const columns = importConfig!.columns;
      const columnIndexes = new Map<string, number>();
      for (const column of columns) {
        const index =
          indexes.get(column.label.toLowerCase()) ?? indexes.get(column.key.toLowerCase());
        if (index !== undefined) columnIndexes.set(column.key, index);
        else if (column.required) throw new Error(`Required column is missing: ${column.label}`);
      }
      const sourceRows = grid.slice(1).filter((row) => row.some((value) => String(value).trim()));
      if (sourceRows.length === 0) throw new Error("The worksheet has no data rows.");
      if (sourceRows.length > MAX_IMPORT_ROWS)
        throw new Error(`Import up to ${MAX_IMPORT_ROWS.toLocaleString()} rows per file.`);
      const parsed: PreviewRow[] = sourceRows.map((values, index) => {
        const row: ExcelRecord = {};
        for (const column of columns) {
          let value = columnIndexes.has(column.key)
            ? String(values[columnIndexes.get(column.key)!] ?? "").trim()
            : "";
          if (/^(mobile|alt_mobile|customer_mobile)$/.test(column.key) && /^\d{10}$/.test(value))
            value = `0${value}`;
          row[column.key] = column.type === "number" && value !== "" ? Number(value) : value;
        }
        let error: string | null = null;
        for (const column of columns) {
          const value = row[column.key];
          if (column.required && (value == null || String(value).trim() === "")) {
            error = `${column.label} is required.`;
            break;
          }
          if (
            column.type === "number" &&
            value !== "" &&
            value != null &&
            !Number.isFinite(Number(value))
          ) {
            error = `${column.label} must be a valid number.`;
            break;
          }
        }
        error ??= importConfig!.validateRow?.(row, index + 2) ?? null;
        return { row, line: index + 2, error };
      });
      setPreview(parsed);
      setOpen(true);
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const importRows = async () => {
    if (!importConfig || preview.some((item) => item.error)) return;
    setBusy(true);
    try {
      const result = await importConfig.onImport(preview.map((item) => item.row));
      const details = [
        `${result.imported} imported`,
        result.skipped ? `${result.skipped} skipped` : "",
        result.errors?.length ? `${result.errors.length} failed` : "",
      ].filter(Boolean);
      if (result.errors?.length) {
        toast.error(`${details.join(" · ")}. ${result.errors[0]}`);
        setImportCompleted(true);
        setPreview(
          result.errors.map((message, index) => ({
            row: {},
            line: index + 2,
            error: message,
          })),
        );
      } else {
        toast.success(details.join(" · "));
        setOpen(false);
      }
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const exportFile = async (item: ExcelExport) => {
    try {
      const blob = await makeDataXlsx(
        item.columns.map((column) => column.label),
        item.rows.map((row) => item.columns.map((column) => row[column.key] ?? "")),
      );
      download(blob, `${item.fileName}.xlsx`);
    } catch (error) {
      toast.error(friendlyError(error));
    }
  };

  return (
    <>
      {canExport &&
        exports.map((item) => (
          <Button key={item.fileName} variant="outline" onClick={() => void exportFile(item)}>
            <Download />
            {item.label}
          </Button>
        ))}
      {canImport && importConfig && (
        <>
          <Button variant="outline" disabled={busy} onClick={chooseFile}>
            <Upload />
            {importLabel}
          </Button>
          <input
            ref={inputRef}
            className="hidden"
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </>
      )}
      {open && importConfig && (
        <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                Import {importConfig.title}
              </DialogTitle>
              <p className="break-all text-sm text-muted-foreground">
                {fileName} · {preview.length} rows
              </p>
              {importConfig.description && (
                <p className="text-sm text-muted-foreground">{importConfig.description}</p>
              )}
            </DialogHeader>
            <div className="max-h-[50dvh] space-y-2 overflow-y-auto rounded-md border p-3">
              {preview.slice(0, 50).map((item) => (
                <div
                  key={item.line}
                  className="flex min-w-0 gap-3 text-sm"
                  aria-label={`Spreadsheet row ${item.line}`}
                >
                  <span className="w-12 shrink-0 text-muted-foreground">#{item.line}</span>
                  <span
                    className={item.error ? "text-destructive" : "min-w-0 break-words line-clamp-2"}
                  >
                    {item.error ??
                      importConfig.columns
                        .map((column) => `${column.label}: ${String(item.row[column.key] ?? "")}`)
                        .filter(Boolean)
                        .join(" · ")}
                  </span>
                </div>
              ))}
              {preview.length > 50 && (
                <p className="text-xs text-muted-foreground">
                  Showing first 50 of {preview.length} rows.
                </p>
              )}
            </div>
            {preview.some((item) => item.error) && !importCompleted && (
              <p className="text-sm text-destructive">
                Fix the listed row errors in Excel and import the file again. No rows have been
                written.
              </p>
            )}
            {importCompleted && (
              <p className="text-sm text-destructive">
                Import finished. Successful rows were saved; correct the remaining failed rows and
                import those rows again.
              </p>
            )}
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void template()}
              >
                <Download />
                Download template
              </Button>
              {importCompleted ? (
                <Button type="button" onClick={() => setOpen(false)}>
                  Close
                </Button>
              ) : (
                <Button
                  disabled={busy || preview.length === 0 || preview.some((item) => item.error)}
                  onClick={() => void importRows()}
                >
                  <Import />
                  {busy ? "Importing…" : `Import ${preview.length} rows`}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
