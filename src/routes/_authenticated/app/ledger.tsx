import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, Stat, selectCls, methodLabel } from "@/components/erp/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { z } from "zod";
import { toast } from "sonner";
import { FileText, FileSpreadsheet, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { makePdf, makeXlsx, download, shareFile, type Sheet } from "@/lib/export";
import { useBranches } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/app/ledger")({
  head: ({ matches }) => ({
    meta: [
      { title: `Party Ledger — ${matchedCompany(matches)}` },
      { name: "description", content: "Customer and supplier ledger with running balance." },
      { property: "og:title", content: `Party Ledger — ${matchedCompany(matches)}` },
      { property: "og:description", content: "Customer and supplier ledger with running balance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: z.object({
    kind: z.enum(["customer", "supplier"]).optional(),
    party: z.string().optional(),
    branch: z.string().optional(),
  }),
  component: Ledger,
});

type Row = {
  date: string;
  created: string;
  text: string;
  ref?: { to: "/app/sales/$id" | "/app/purchases/$id"; id: string; label: string };
  plus: number;
  minus: number;
};

function Ledger() {
  const { business, role, userId } = useBusiness();
  const search = Route.useSearch();
  const [kind, setKind] = useState<"customer" | "supplier">(search.kind ?? "customer");
  const [party, setParty] = useState(search.party ?? "");
  const branches = useBranches(business.id);
  const isCentral = ["owner", "manager", "accountant"].includes(role);
  const branchAccess = useQuery({
    queryKey: ["ledger-branch-access", business.id, userId],
    enabled: !isCentral,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_finance_branch_access")
        .select("branch_id")
        .eq("business_id", business.id)
        .eq("user_id", userId);
      if (error) throw error;
      return data.map((entry) => entry.branch_id);
    },
  });
  const accessibleBranches = (branches.data ?? []).filter(
    (branch) =>
      branch.kind === "branch" && (isCentral || (branchAccess.data ?? []).includes(branch.id)),
  );
  const [branchId, setBranchId] = useState(search.branch ?? "");
  useEffect(() => {
    if (!accessibleBranches.some((branch) => branch.id === branchId)) {
      setBranchId(accessibleBranches[0]?.id ?? "");
    }
  }, [accessibleBranches, branchId]);

  const parties = useQuery({
    queryKey: ["ledger-parties", kind, business.id, branchId],
    queryFn: async () => {
      if (kind === "customer") {
        if (!branchId) return [];
        const { data, error } = await supabase
          .from("customer_branch_balances")
          .select("customer_id,name,mobile")
          .eq("business_id", business.id)
          .eq("branch_id", branchId)
          .order("name");
        if (error) throw error;
        return data.flatMap((customer) =>
          customer.customer_id
            ? [{ id: customer.customer_id, name: customer.name, mobile: customer.mobile }]
            : [],
        );
      }
      const { data, error } = await supabase
        .from("suppliers")
        .select("id,name,mobile")
        .eq("business_id", business.id)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const ledger = useQuery({
    enabled: !!party && (kind === "supplier" || Boolean(branchId)),
    queryKey: ["ledger", kind, party, branchId],
    queryFn: async (): Promise<{ opening: number; rows: Row[]; limit?: number }> => {
      if (kind === "customer") {
        const [c, s, p, r] = await Promise.all([
          supabase
            .from("customer_branch_balances")
            .select("opening_balance,credit_limit")
            .eq("customer_id", party)
            .eq("branch_id", branchId)
            .single(),
          supabase
            .from("sales")
            .select("id,invoice_no,sale_date,total,created_at")
            .eq("customer_id", party)
            .eq("branch_id", branchId)
            .eq("status", "posted"),
          supabase
            .from("customer_payments")
            .select("id,paid_on,amount,method,txn_ref,sale_id,created_at")
            .eq("customer_id", party)
            .eq("branch_id", branchId),
          supabase
            .from("sales_returns")
            .select("id,return_no,return_date,total,refund,sale_id,created_at,sales(invoice_no)")
            .eq("customer_id", party)
            .eq("branch_id", branchId),
        ]);
        for (const x of [c, s, p, r]) if (x.error) throw x.error;
        const rows: Row[] = [
          ...s.data!.map((x) => ({
            date: x.sale_date,
            created: x.created_at,
            text: "Sale",
            ref: { to: "/app/sales/$id" as const, id: x.id, label: x.invoice_no },
            plus: Number(x.total),
            minus: 0,
          })),
          ...p.data!.map((x) => ({
            date: x.paid_on,
            created: x.created_at,
            text: `Payment · ${methodLabel(x.method)}${x.txn_ref ? ` · ${x.txn_ref}` : ""}`,
            plus: 0,
            minus: Number(x.amount),
          })),
          ...r.data!.flatMap((x) => [
            {
              date: x.return_date,
              created: x.created_at,
              text: `Sales return ${x.return_no}`,
              ref: {
                to: "/app/sales/$id" as const,
                id: x.sale_id,
                label: x.sales?.invoice_no ?? "",
              },
              plus: 0,
              minus: Number(x.total),
            },
            ...(Number(x.refund) > 0
              ? [
                  {
                    date: x.return_date,
                    created: x.created_at + "z",
                    text: `Refund paid for ${x.return_no}`,
                    plus: Number(x.refund),
                    minus: 0,
                  },
                ]
              : []),
          ]),
        ];
        return {
          opening: Number(c.data!.opening_balance),
          rows,
          limit: Number(c.data!.credit_limit),
        };
      }
      const [su, pu, pa, r] = await Promise.all([
        supabase.from("suppliers").select("opening_payable").eq("id", party).single(),
        supabase
          .from("purchases")
          .select("id,invoice_no,purchase_date,total,created_at")
          .eq("supplier_id", party)
          .eq("status", "posted"),
        supabase
          .from("supplier_payments")
          .select("id,paid_on,amount,method,txn_ref,created_at")
          .eq("supplier_id", party),
        supabase
          .from("purchase_returns")
          .select(
            "id,return_no,return_date,total,refund,purchase_id,created_at,purchases(invoice_no)",
          )
          .eq("supplier_id", party),
      ]);
      for (const x of [su, pu, pa, r]) if (x.error) throw x.error;
      const rows: Row[] = [
        ...pu.data!.map((x) => ({
          date: x.purchase_date,
          created: x.created_at,
          text: "Purchase",
          ref: { to: "/app/purchases/$id" as const, id: x.id, label: x.invoice_no },
          plus: Number(x.total),
          minus: 0,
        })),
        ...pa.data!.map((x) => ({
          date: x.paid_on,
          created: x.created_at,
          text: `Payment · ${methodLabel(x.method)}${x.txn_ref ? ` · ${x.txn_ref}` : ""}`,
          plus: 0,
          minus: Number(x.amount),
        })),
        ...r.data!.flatMap((x) => [
          {
            date: x.return_date,
            created: x.created_at,
            text: `Purchase return ${x.return_no}`,
            ref: {
              to: "/app/purchases/$id" as const,
              id: x.purchase_id,
              label: x.purchases?.invoice_no ?? "",
            },
            plus: 0,
            minus: Number(x.total),
          },
          ...(Number(x.refund) > 0
            ? [
                {
                  date: x.return_date,
                  created: x.created_at + "z",
                  text: `Refund received for ${x.return_no}`,
                  plus: Number(x.refund),
                  minus: 0,
                },
              ]
            : []),
        ]),
      ];
      return { opening: Number(su.data!.opening_payable), rows };
    },
  });

  const rows = [...(ledger.data?.rows ?? [])].sort((a, b) =>
    (a.date + a.created).localeCompare(b.date + b.created),
  );
  let bal = ledger.data?.opening ?? 0;
  const withBal = rows.map((r) => {
    bal += r.plus - r.minus;
    return { ...r, bal };
  });
  const tot = (k: "plus" | "minus", f: (r: Row) => boolean) =>
    rows.filter(f).reduce((s, r) => s + r[k], 0);
  const isC = kind === "customer";
  const [busy, setBusy] = useState(false);
  const p = parties.data?.find((x) => x.id === party);
  const sheet = (): Sheet => ({
    title: `${business.name} — ${isC ? "Customer" : "Supplier"} Ledger`,
    subtitle: [
      `${p?.name ?? ""} · ${p?.mobile ?? ""}`,
      `${isC ? "Current due" : "Current payable"}: Tk ${bal.toFixed(2)} · Generated ${new Date().toLocaleString("en-GB")}`,
    ],
    head: ["Date", "Details", "Ref", isC ? "Due +" : "Payable +", "Less -", "Balance"],
    rows: [
      ["", "Opening balance", "", "", "", ledger.data?.opening ?? 0],
      ...withBal.map((r) => [
        r.date,
        r.text,
        r.ref?.label ?? "",
        r.plus || "",
        r.minus || "",
        r.bal,
      ]),
    ],
    fileName: `${isC ? "customer" : "supplier"}-ledger-${(p?.name ?? "party").replace(/[^\w\u0980-\u09FF]+/g, "-")}-${new Date().toISOString().slice(0, 10)}`,
  });
  const act = async (what: "pdf" | "xlsx" | "share") => {
    setBusy(true);
    try {
      const s = sheet();
      if (what === "xlsx") download(await makeXlsx(s), s.fileName + ".xlsx");
      else {
        const blob = await makePdf(s);
        if (what === "pdf") download(blob, s.fileName + ".pdf");
        else {
          const r = await shareFile(
            blob,
            s.fileName + ".pdf",
            `${s.title}\n${s.subtitle.join("\n")}`,
          );
          if (r === "fallback") toast.info("PDF downloaded. Attach it in WhatsApp to send.");
        }
      }
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isC ? "Customer Ledger" : "Supplier Ledger"}
        sub={
          isC
            ? "Every sale, payment and return with running due"
            : "Every purchase, payment and return with running payable"
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex rounded-md border p-0.5 text-sm">
          {(["customer", "supplier"] as const).map((k) => (
            <button
              key={k}
              onClick={() => {
                setKind(k);
                setParty("");
              }}
              className={cn(
                "rounded px-3 py-1.5",
                kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {k === "customer" ? "Customers" : "Suppliers"}
            </button>
          ))}
        </div>
        {isC && (
          <F label="Brand shop" className="min-w-48">
            <select
              className={selectCls}
              value={branchId}
              onChange={(event) => {
                setBranchId(event.target.value);
                setParty("");
              }}
            >
              {accessibleBranches.length === 0 && <option value="">No assigned shop</option>}
              {accessibleBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </F>
        )}
        <F label={isC ? "Customer" : "Supplier"} className="min-w-64">
          <select className={selectCls} value={party} onChange={(e) => setParty(e.target.value)}>
            <option value="">— Select —</option>
            {(parties.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.mobile}
              </option>
            ))}
          </select>
        </F>
        {ledger.data && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => act("pdf")}>
              <FileText className="mr-1 h-4 w-4" />
              PDF
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => act("xlsx")}>
              <FileSpreadsheet className="mr-1 h-4 w-4" />
              Excel
            </Button>
            <Button disabled={busy} onClick={() => act("share")}>
              <Share2 className="mr-1 h-4 w-4" />
              Share
            </Button>
          </div>
        )}
      </div>

      {!party && (
        <p className="text-sm text-muted-foreground">Choose a {kind} to see their ledger.</p>
      )}
      {ledger.error && <p className="text-sm text-destructive">{friendlyError(ledger.error)}</p>}
      {ledger.data && (
        <>
          <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Opening" value={ledger.data.opening} />
            <Stat
              label={isC ? "Sales" : "Purchases"}
              value={tot("plus", (r) => !!r.ref && r.minus === 0)}
            />
            <Stat label="Payments" value={tot("minus", (r) => r.text.startsWith("Payment"))} />
            <Stat label="Returns" value={tot("minus", (r) => r.text.includes("return"))} />
            <Stat
              label={isC ? "Current due" : "Current payable"}
              value={bal}
              tone={bal > 0 ? "neg" : undefined}
              note={
                isC && ledger.data.limit
                  ? `Available credit ${bdt(Math.max(0, ledger.data.limit - bal))}`
                  : undefined
              }
            />
          </div>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Ref</TableHead>
                  <TableHead className="text-right">{isC ? "Due +" : "Payable +"}</TableHead>
                  <TableHead className="text-right">Less −</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell />
                  <TableCell className="font-medium">Opening balance</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell className="num text-right">{bdt(ledger.data.opening)}</TableCell>
                </TableRow>
                {withBal.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="num">{r.date}</TableCell>
                    <TableCell>{r.text}</TableCell>
                    <TableCell>
                      {r.ref && (
                        <Link
                          to={r.ref.to}
                          params={{ id: r.ref.id }}
                          className="num text-primary hover:underline"
                        >
                          {r.ref.label}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="num text-right">{r.plus ? bdt(r.plus) : ""}</TableCell>
                    <TableCell className="num text-right">{r.minus ? bdt(r.minus) : ""}</TableCell>
                    <TableCell className="num text-right font-semibold">{bdt(r.bal)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
