import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { docTypeLabel, statusVariant } from "@/lib/quote";
import { PageHeader } from "@/components/erp/EntityManager";
import { selectCls } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/quotations/")({
  head: ({ matches }) => ({
    meta: [
      { title: `Quotations & Estimates — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Create and track quotations, estimates and proforma invoices in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Quotations & Estimates — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "Price offers that convert into real sales.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QuotationsList,
});

function QuotationsList() {
  const { business } = useBusiness();
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");

  const list = useQuery({
    queryKey: ["quotations", business.id, type, status],
    queryFn: async () => {
      let query = supabase
        .from("quotations")
        .select(
          "id,quote_no,doc_type,quote_date,valid_until,total,status,customers(name,mobile),branches(name)",
        )
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (type !== "all") query = query.eq("doc_type", type);
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const rows = useMemo(() => {
    const s = q.toLowerCase().trim();
    return (list.data ?? []).filter(
      (r) =>
        !s ||
        [r.quote_no, r.customers?.name, r.customers?.mobile].some((x) =>
          (x ?? "").toLowerCase().includes(s),
        ),
    );
  }, [list.data, q]);

  const open = rows.filter((r) => r.status === "sent" || r.status === "draft").length;
  const won = rows.filter((r) => r.status === "converted" || r.status === "accepted").length;
  const value = rows.reduce((a, r) => a + Number(r.total), 0);

  return (
    <div>
      <PageHeader
        title="Quotations & Estimates"
        sub={`${rows.length} documents · ${bdt(value)} · ${open} open · ${won} accepted/converted`}
        actions={
          <Button asChild>
            <Link to="/app/quotations/new">
              <Plus className="mr-1 h-4 w-4" />
              New document
            </Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <select
          className={selectCls + " max-w-[10rem]"}
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="all">All types</option>
          <option value="quotation">Quotation</option>
          <option value="estimate">Estimate</option>
          <option value="proforma">Proforma</option>
        </select>
        <select
          className={selectCls + " max-w-[11rem]"}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">Any status</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="expired">Expired</option>
          <option value="converted">Converted</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <Input
          placeholder="Search number, customer, mobile…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <div className="rounded-lg border bg-card">
        {list.error ? (
          <p className="p-6 text-sm text-destructive">{friendlyError(list.error)}</p>
        ) : !rows.length ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No quotations yet. Create one to send a priced offer.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Valid until</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to="/app/quotations/$id"
                        params={{ id: r.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.quote_no}
                      </Link>
                    </TableCell>
                    <TableCell>{docTypeLabel(r.doc_type)}</TableCell>
                    <TableCell className="num">{r.quote_date}</TableCell>
                    <TableCell className="num">{r.valid_until ?? "—"}</TableCell>
                    <TableCell>{r.customers?.name ?? "Walk-in"}</TableCell>
                    <TableCell>{r.branches?.name}</TableCell>
                    <TableCell className="num text-right">{bdt(r.total)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
