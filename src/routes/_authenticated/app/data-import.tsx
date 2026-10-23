import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Database, FileUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { friendlyError } from "@/lib/format";
import {
  createCurrentDataBackup,
  parseLegacyArchive,
  type CurrentDataPreview,
  type LegacyArchive,
  type LegacyOperationalBackup,
} from "@/lib/legacy-archive";
import { PageHeader } from "@/components/erp/EntityManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/app/data-import")({
  head: () => ({
    meta: [
      { title: "Products, Parties & Balances" },
      {
        name: "description",
        content: "Import product, customer, dealer, supplier and current balance data.",
      },
    ],
  }),
  component: DataImportPage,
});

const CONFIRMATION = "REPLACE FIROZA ERP DATA";

type TableCounts = { existing: number; incoming: number };
type ServerPreview = {
  business_id: string;
  replaces_records: number;
  imports_records: number;
  tables: Record<string, TableCounts>;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`The server returned an invalid ${field} count.`);
  }
  return value;
}

function parseServerPreview(value: unknown): ServerPreview {
  const row = objectValue(value);
  const sourceTables = objectValue(row?.["tables"]);
  if (!row || !sourceTables || typeof row["business_id"] !== "string") {
    throw new Error("The server returned an invalid operational import preview.");
  }
  const tables: Record<string, TableCounts> = {};
  for (const [name, counts] of Object.entries(sourceTables)) {
    const parsed = objectValue(counts);
    if (!parsed) throw new Error(`The server returned invalid counts for ${name}.`);
    tables[name] = {
      existing: safeInteger(parsed["existing"], `${name} existing`),
      incoming: safeInteger(parsed["incoming"], `${name} incoming`),
    };
  }
  return {
    business_id: row["business_id"],
    replaces_records: safeInteger(row["replaces_records"], "replacement"),
    imports_records: safeInteger(row["imports_records"], "import"),
    tables,
  };
}

function DataImportPage() {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [archive, setArchive] = useState<LegacyArchive | null>(null);
  const [backup, setBackup] = useState<LegacyOperationalBackup | null>(null);
  const [dataPreview, setDataPreview] = useState<CurrentDataPreview | null>(null);
  const [serverPreview, setServerPreview] = useState<ServerPreview | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);

  const onFile = async (file?: File) => {
    if (!file) return;
    setArchive(null);
    setBackup(null);
    setDataPreview(null);
    setServerPreview(null);
    setCompleted(false);
    setConfirm("");
    try {
      if (file.size > 40 * 1024 * 1024) {
        throw new Error("The data file exceeds the 40 MB safety limit.");
      }
      const parsed = parseLegacyArchive(JSON.parse(await file.text()));
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error("Sign in as the business owner before importing.");
      const transformed = createCurrentDataBackup(parsed, business.id, authData.user.id);
      const { data, error } = await supabase.rpc("preview_legacy_operational_import", {
        _biz: business.id,
        _data: transformed.backup,
      });
      if (error) throw error;
      const parsedServerPreview = parseServerPreview(data);
      if (parsedServerPreview.business_id !== business.id) {
        throw new Error("The server preview does not match the selected business.");
      }
      setArchive(parsed);
      setBackup(transformed.backup);
      setDataPreview(transformed.preview);
      setServerPreview(parsedServerPreview);
      toast.success("Data preview validated. No records have been changed.");
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const runImport = async () => {
    if (
      !archive ||
      !backup ||
      !serverPreview ||
      serverPreview.business_id !== business.id ||
      confirm !== CONFIRMATION ||
      busy
    ) {
      return;
    }
    setBusy(true);
    setCompleted(false);
    try {
      const { error } = await supabase.rpc("restore_business", {
        _biz: business.id,
        _data: backup,
        _confirm: "RESTORE",
      });
      if (error) throw error;
      setCompleted(true);
      setConfirm("");
      await qc.invalidateQueries();
      toast.success("Product, party and balance data updated.");
    } catch (error) {
      toast.error(
        `The replacement was rolled back if the database rejected it. ${friendlyError(error)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  if (role !== "owner") {
    return <p className="text-sm text-muted-foreground">Data replacement is owner-only.</p>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Products, parties & balances"
        sub="Import product and stock lists, customers, dealers, suppliers and their current balances."
      />
      <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div>
          <p className="font-semibold">This operation replaces the selected business data.</p>
          <p className="mt-1 text-muted-foreground">
            Only products, stock quantities, customers, dealers, suppliers and current due balances
            are retained. Sales, purchases, payment history and IMEI records are not imported.
            Product records stay inactive until their missing selling prices are reviewed. The
            server verifies tenant ownership and performs the replacement in one transaction.
          </p>
        </div>
      </div>

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <div className="flex items-center gap-2 font-semibold">
          <Database className="h-5 w-5" />
          Select company data file
        </div>
        <p className="text-sm text-muted-foreground">
          Choose the prepared company CSV data archive. The preview checks replacement counts for
          the selected business. It does not write records.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => void onFile(event.target.files?.[0])}
        />
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
          <FileUp className="mr-2 h-4 w-4" />
          Choose data file
        </Button>
      </section>

      {dataPreview && serverPreview && (
        <>
          <section className="space-y-3 rounded-lg border bg-card p-5">
            <h2 className="font-semibold">Validated replacement preview</h2>
            <p className="text-sm text-muted-foreground">
              Business: <strong>{business.name}</strong>. Production will replace{" "}
              <strong>{serverPreview.replaces_records.toLocaleString()}</strong> existing
              tenant-scoped records with{" "}
              <strong>{serverPreview.imports_records.toLocaleString()}</strong> imported records.
              There are no production writes until you confirm below.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Metric label="Customers" value={dataPreview.customers.toLocaleString()} />
              <Metric label="Dealers" value={dataPreview.dealers.toLocaleString()} />
              <Metric label="Suppliers" value={dataPreview.suppliers.toLocaleString()} />
              <Metric
                label="Products / stock items"
                value={`${dataPreview.products.toLocaleString()} / ${dataPreview.stockItems.toLocaleString()}`}
              />
              <Metric
                label="Current customer due"
                value={dataPreview.customerDue.toLocaleString()}
              />
              <Metric
                label="Current supplier payable"
                value={dataPreview.supplierPayable.toLocaleString()}
              />
            </div>
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full min-w-[460px] text-left text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="p-2 font-medium">Data list</th>
                    <th className="p-2 text-right font-medium">Existing rows replaced</th>
                    <th className="p-2 text-right font-medium">Incoming rows</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(serverPreview.tables).map(([table, counts]) => (
                    <tr key={table} className="border-t">
                      <td className="p-2 font-mono text-xs">{table}</td>
                      <td className="p-2 text-right">{counts.existing.toLocaleString()}</td>
                      <td className="p-2 text-right">{counts.incoming.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3 rounded-lg border bg-card p-5">
            {completed ? (
              <div className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" />
                <p>
                  Product, stock, customer, dealer, supplier and current balance data updated for{" "}
                  {business.name}. Transaction history and IMEI records were not imported.
                </p>
              </div>
            ) : (
              <>
                <label htmlFor="data-import-confirm" className="text-sm font-medium">
                  To replace the current data with this preview, type <code>{CONFIRMATION}</code>
                </label>
                <Input
                  id="data-import-confirm"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="off"
                  disabled={busy}
                />
                <Button
                  variant="destructive"
                  onClick={() => void runImport()}
                  disabled={busy || confirm !== CONFIRMATION}
                >
                  {busy ? "Replacing business data…" : "Replace data with this list"}
                </Button>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
