import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { useMoneyAccounts } from "@/lib/finance";
import { bdt, friendlyError } from "@/lib/format";
import { F, selectCls, today } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type ReturnLine = {
  id: string;
  label: string;
  remaining: number;
  unitValue: number;
  imeis?: { id: string; imei1: string }[]; // serialized purchase items: pick IMEIs
  imeiLabel?: string | null; // serialized sale item (single IMEI)
};

export function ReturnDialog({
  kind,
  docId,
  lines,
  partyLabel,
}: {
  kind: "sale" | "purchase";
  docId: string;
  lines: ReturnLine[];
  partyLabel: string;
}) {
  const { business } = useBusiness();
  const qc = useQueryClient();
  const accounts = useMoneyAccounts(business.id);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [refund, setRefund] = useState("0");
  const [account, setAccount] = useState("");
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState("");

  const qtyOf = (l: ReturnLine) => (l.imeis ? (picked[l.id]?.length ?? 0) : (qty[l.id] ?? 0));
  const value = lines.reduce((s, l) => s + qtyOf(l) * l.unitValue, 0);

  const m = useMutation({
    mutationFn: async () => {
      const items = lines
        .filter((l) => qtyOf(l) > 0)
        .map((l) =>
          kind === "sale"
            ? { sale_item_id: l.id, qty: qtyOf(l) }
            : { purchase_item_id: l.id, qty: qtyOf(l), imei_ids: picked[l.id] ?? [] },
        );
      if (!items.length) throw new Error("Select at least one item to return.");
      const base = {
        return_date: date,
        reason,
        refund: Number(refund) || 0,
        refund_account_id: account,
        items,
      };
      const { error } =
        kind === "sale"
          ? await supabase.rpc("create_sales_return", {
              _biz: business.id,
              _data: { ...base, sale_id: docId },
            })
          : await supabase.rpc("create_purchase_return", {
              _biz: business.id,
              _data: { ...base, purchase_id: docId },
            });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Return recorded — stock, due and accounts updated");
      setOpen(false);
      setQty({});
      setPicked({});
      setRefund("0");
      setReason("");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const available = lines.filter((l) => l.remaining > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!available.length}>
          <Undo2 className="mr-1 h-4 w-4" />
          {kind === "sale" ? "Sales Return" : "Purchase Return"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {kind === "sale" ? "Return from customer" : "Return to supplier"} · {partyLabel}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {available.map((l) => (
            <div key={l.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{l.label}</div>
                  <div className="num text-xs text-muted-foreground">
                    {l.imeiLabel ? `IMEI ${l.imeiLabel} · ` : ""}Can return {l.remaining} ·{" "}
                    {bdt(l.unitValue)} each
                  </div>
                </div>
                {!l.imeis && (
                  <Input
                    type="number"
                    min={0}
                    max={l.remaining}
                    className="num w-24"
                    value={qty[l.id] ?? 0}
                    onChange={(e) =>
                      setQty({
                        ...qty,
                        [l.id]: Math.max(0, Math.min(l.remaining, Number(e.target.value) || 0)),
                      })
                    }
                  />
                )}
              </div>
              {l.imeis && (
                <div className="mt-2 flex flex-wrap gap-3">
                  {l.imeis.map((im) => {
                    const on = picked[l.id]?.includes(im.id) ?? false;
                    return (
                      <label
                        key={im.id}
                        className="num flex items-center gap-1.5 font-mono text-xs"
                      >
                        <Checkbox
                          checked={on}
                          onCheckedChange={(c) => {
                            const cur = picked[l.id] ?? [];
                            setPicked({
                              ...picked,
                              [l.id]: c ? [...cur, im.id] : cur.filter((x) => x !== im.id),
                            });
                          }}
                        />
                        {im.imei1}
                      </label>
                    );
                  })}
                  {!l.imeis.length && (
                    <span className="text-xs text-muted-foreground">
                      No IMEIs from this purchase are in stock.
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="Return date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </F>
          <F label="Reason">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Defective, wrong model…"
            />
          </F>
          <F label={kind === "sale" ? "Refund to customer (৳)" : "Refund received (৳)"}>
            <Input
              type="number"
              min={0}
              className="num"
              value={refund}
              onChange={(e) => setRefund(e.target.value)}
            />
          </F>
          <F label={kind === "sale" ? "Pay refund from" : "Refund received in"}>
            <select
              className={selectCls}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">— Select account —</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id!} value={a.id!}>
                  {a.name} ({bdt(a.balance)})
                </option>
              ))}
            </select>
          </F>
        </div>
        <p className="num text-sm">
          Return value <b>{bdt(value)}</b>
          {kind === "sale" ? " (before invoice discount/tax share)" : " at landed cost"}. Anything
          not refunded
          {kind === "sale" ? " reduces the customer's due." : " reduces what you owe the supplier."}
        </p>
        <DialogFooter>
          <Button onClick={() => m.mutate()} disabled={m.isPending || value <= 0}>
            Confirm return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
