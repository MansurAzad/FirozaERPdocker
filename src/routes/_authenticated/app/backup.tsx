import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Upload, RotateCcw, Database } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { F } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/app/backup")({
  head: ({ matches }) => ({
    meta: [
      { title: `Backup, Restore & Reset — ${matchedCompany(matches)}` },
      { name: "description", content: "Download, restore or reset your business data." },
      { property: "og:title", content: `Backup, Restore & Reset — ${matchedCompany(matches)}` },
      { property: "og:description", content: "Download, restore or reset your business data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BackupPage,
});

type Pending = { kind: "restore"; data: unknown; name: string } | { kind: "transactions" | "full" };

function BackupPage() {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirm, setConfirm] = useState("");

  const download = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("export_business", { _biz: business.id });
      if (error) throw error;
      const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `mobile-derp-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    onSuccess: () => toast.success("Backup downloaded"),
    onError: (e) => toast.error(friendlyError(e)),
  });

  const run = useMutation({
    mutationFn: async () => {
      if (!pending) return;
      if (pending.kind === "restore") {
        const { error } = await supabase.rpc("restore_business", {
          _biz: business.id,
          _data: pending.data as never,
          _confirm: confirm,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("reset_business", {
          _biz: business.id,
          _mode: pending.kind,
          _confirm: confirm,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(pending?.kind === "restore" ? "Backup restored" : "Data reset done");
      setPending(null);
      setConfirm("");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data?.app !== "MOBILE D-ERP") throw new Error();
      setConfirm("");
      setPending({ kind: "restore", data, name: file.name });
    } catch {
      toast.error(`This is not a compatible ${business.name} backup file.`);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  if (role !== "owner")
    return (
      <p className="text-sm text-muted-foreground">
        Backup, restore and reset are available to the owner only.
      </p>
    );
  const word = pending?.kind === "restore" ? "RESTORE" : "RESET";

  return (
    <div>
      <PageHeader title="Backup & Reset" sub="ব্যাকআপ, রিস্টোর ও রিসেট" />
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Card
          title="Products, parties & balances"
          icon={<Database className="h-5 w-5" />}
          text="Review the current product, stock, customer, dealer, supplier and balance lists before replacing business data."
        >
          <Button variant="outline" asChild>
            <Link to="/app/data-import">Review data import</Link>
          </Button>
        </Card>
        <Card
          title="Download backup"
          icon={<Download className="h-5 w-5" />}
          text="Saves all products, IMEIs, customers, suppliers, sales, purchases, payments, expenses and accounts to one file. Keep it somewhere safe."
        >
          <Button onClick={() => download.mutate()} disabled={download.isPending}>
            {download.isPending ? "Preparing…" : "Download backup"}
          </Button>
        </Card>
        <Card
          title="Restore backup"
          icon={<Upload className="h-5 w-5" />}
          text="Replaces all current data with the data in a backup file from this business. Download a fresh backup first."
        >
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            Choose backup file
          </Button>
        </Card>
        <Card
          title="Reset data"
          icon={<RotateCcw className="h-5 w-5" />}
          text="Start fresh. Staff, branches, chart of accounts and expense categories are always kept."
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setConfirm("");
                setPending({ kind: "transactions" });
              }}
            >
              Clear transactions
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirm("");
                setPending({ kind: "full" });
              }}
            >
              Full reset
            </Button>
          </div>
        </Card>
      </div>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === "restore"
                ? "Restore backup"
                : pending?.kind === "full"
                  ? "Full reset"
                  : "Clear transactions"}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run.mutate();
            }}
          >
            <p className="text-sm text-muted-foreground">
              {pending?.kind === "restore" && (
                <>
                  All current data will be replaced with <b>{pending.name}</b>.
                </>
              )}
              {pending?.kind === "transactions" &&
                "Deletes all sales, purchases, returns, payments, expenses, cash entries, stock and IMEIs. Products, customers, suppliers and accounts stay; their opening balances are kept."}
              {pending?.kind === "full" &&
                "Deletes everything above plus products, brands, categories, customers, suppliers, commission rules and cash/bank accounts. A new Main Cash account is created."}{" "}
              This cannot be undone.
            </p>
            <F label={`Type ${word} to confirm`}>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus />
            </F>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={confirm !== word || run.isPending}>
                {run.isPending ? "Working…" : "Confirm"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Card({
  title,
  icon,
  text,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </div>
      <p className="flex-1 text-sm text-muted-foreground">{text}</p>
      <div>{children}</div>
    </div>
  );
}
