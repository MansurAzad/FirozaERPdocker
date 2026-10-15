import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, Plus, Send, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { selectCls } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/customer-portal")({
  head: ({ matches }) => ({
    meta: [
      { title: `Customer Portal & Payment Requests — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Share statement links and request payments from customers in ${matchedCompany(matches)}.`,
      },
    ],
  }),
  component: CustomerPortalAdmin,
});

const ROLES = ["owner", "manager", "accountant"];

type Balance = {
  customer_id: string;
  name: string;
  business_name: string | null;
  mobile: string;
  current_due: number;
};

type PaymentRequest = {
  id: string;
  customer_id: string;
  amount: number;
  due_date: string | null;
  description: string | null;
  status: string | null;
  created_at: string;
};

function waLink(mobile: string, text: string) {
  const digits = mobile.replace(/\D/g, "");
  const intl = digits.startsWith("880") ? digits : "88" + digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

function CustomerPortalAdmin() {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const allowed = ROLES.includes(role);

  const [q, setQ] = useState("");
  const [custId, setCustId] = useState("");
  const [days, setDays] = useState("30");
  const [link, setLink] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState("");

  const [reqCust, setReqCust] = useState("");
  const [reqAmount, setReqAmount] = useState("");
  const [reqDue, setReqDue] = useState("");
  const [reqDesc, setReqDesc] = useState("");

  const balances = useQuery({
    queryKey: ["portal-balances", business.id],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_balances")
        .select("customer_id,name,business_name,mobile,current_due")
        .eq("business_id", business.id)
        .order("current_due", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Balance[];
    },
  });

  const requests = useQuery({
    queryKey: ["payment-requests", business.id],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_payment_requests")
        .select("id,customer_id,amount,due_date,description,status,created_at")
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as PaymentRequest[];
    },
  });

  const all = useMemo(() => balances.data ?? [], [balances.data]);
  const custMap = useMemo(() => new Map(all.map((c) => [c.customer_id, c] as const)), [all]);

  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    if (!s) return all;
    return all.filter((c) =>
      [c.name, c.business_name, c.mobile].some((x) => (x ?? "").toLowerCase().includes(s)),
    );
  }, [all, q]);

  const selected = custMap.get(custId);

  const genLink = useMutation({
    mutationFn: async () => {
      if (!custId) throw new Error("Choose a customer first.");
      const { data, error } = await supabase.rpc("generate_customer_portal_token", {
        _biz: business.id,
        _customer_id: custId,
        _expires_in_days: Number(days) || 30,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (token) => {
      const url = `${window.location.origin}/portal?token=${encodeURIComponent(token)}`;
      setLink(url);
      setLinkFor(selected?.name ?? "");
      toast.success("Statement link created");
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const addRequest = useMutation({
    mutationFn: async () => {
      if (!reqCust) throw new Error("Choose a customer.");
      const amount = Number(reqAmount);
      if (!(amount > 0)) throw new Error("Enter an amount greater than zero.");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("create_payment_request", {
        _biz: business.id,
        _customer_id: reqCust,
        _amount: amount,
        _due_date: reqDue || null,
        _description: reqDesc.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment request sent");
      setReqAmount("");
      setReqDue("");
      setReqDesc("");
      qc.invalidateQueries({ queryKey: ["payment-requests"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("customer_payment_requests")
        .update({ status, paid_at: status === "paid" ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["payment-requests"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Customer Portal" sub="Share statements and request payments." />
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Only the owner, manager or accountant can manage the customer portal.
        </p>
      </div>
    );
  }

  const pendingTotal = (requests.data ?? [])
    .filter((r) => r.status === "pending")
    .reduce((s, r) => s + Number(r.amount ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer Portal & Payment Requests"
        sub="Send a passwordless statement link, then request and track customer payments."
      />

      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Link2 className="h-4 w-4" /> Send a statement link
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <Label htmlFor="portal-cust">Customer</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name / mobile…"
              className="mb-2 mt-1"
            />
            <select
              id="portal-cust"
              className={selectCls}
              value={custId}
              onChange={(e) => {
                setCustId(e.target.value);
                setLink(null);
              }}
            >
              <option value="">Choose a customer…</option>
              {filtered.map((c) => (
                <option key={c.customer_id} value={c.customer_id}>
                  {c.name}
                  {c.mobile ? ` · ${c.mobile}` : ""} — due {bdt(c.current_due)}
                </option>
              ))}
            </select>
          </div>
          <div className="w-28">
            <Label htmlFor="portal-days">Valid (days)</Label>
            <Input
              id="portal-days"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="mt-1"
            />
          </div>
          <Button disabled={!custId || genLink.isPending} onClick={() => genLink.mutate()}>
            <Link2 className="mr-1 h-4 w-4" />
            Generate link
          </Button>
        </div>

        {link ? (
          <div className="mt-4 rounded-md border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">Link for {linkFor}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input readOnly value={link} className="min-w-[18rem] flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(link);
                  toast.success("Link copied");
                }}
              >
                <Copy className="mr-1 h-4 w-4" />
                Copy
              </Button>
              {selected?.mobile ? (
                <Button asChild variant="outline" size="sm">
                  <a
                    href={waLink(
                      selected.mobile,
                      `Assalamu alaikum ${selected.name}, here is your account statement from ${business.name}: ${link}`,
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Send className="mr-1 h-4 w-4" />
                    WhatsApp
                  </a>
                </Button>
              ) : null}
              <Button asChild variant="outline" size="sm">
                <a href={link} target="_blank" rel="noreferrer">
                  Open
                </a>
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Anyone with this link can open the statement until it expires. Send it only to the
              customer.
            </p>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Plus className="h-4 w-4" /> Request a payment
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor="req-cust">Customer</Label>
            <select
              id="req-cust"
              className={selectCls + " mt-1"}
              value={reqCust}
              onChange={(e) => setReqCust(e.target.value)}
            >
              <option value="">Choose a customer…</option>
              {all.map((c) => (
                <option key={c.customer_id} value={c.customer_id}>
                  {c.name}
                  {c.mobile ? ` · ${c.mobile}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="w-36">
            <Label htmlFor="req-amount">Amount</Label>
            <Input
              id="req-amount"
              type="number"
              min={0}
              step="0.01"
              value={reqAmount}
              onChange={(e) => setReqAmount(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="w-40">
            <Label htmlFor="req-due">Due date</Label>
            <Input
              id="req-due"
              type="date"
              value={reqDue}
              onChange={(e) => setReqDue(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor="req-desc">Note</Label>
            <Input
              id="req-desc"
              value={reqDesc}
              onChange={(e) => setReqDesc(e.target.value)}
              placeholder="Optional description"
              className="mt-1"
            />
          </div>
          <Button disabled={addRequest.isPending} onClick={() => addRequest.mutate()}>
            <Plus className="mr-1 h-4 w-4" />
            Add request
          </Button>
        </div>
      </section>

      <section className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Payment requests</h2>
          <span className="num text-sm text-muted-foreground">
            {requests.data?.length ?? 0} total · pending {bdt(pendingTotal)}
          </span>
        </div>
        {requests.error ? (
          <p className="p-4 text-sm text-destructive">{friendlyError(requests.error)}</p>
        ) : !requests.data?.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No payment requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.data.map((r) => {
                  const cust = custMap.get(r.customer_id);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div>{cust?.name ?? "—"}</div>
                        {cust?.mobile ? (
                          <div className="num text-xs text-muted-foreground">{cust.mobile}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="num text-right">{bdt(r.amount)}</TableCell>
                      <TableCell className="num">{r.due_date ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.description ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.status === "paid"
                              ? "default"
                              : r.status === "cancelled"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {r.status ?? "pending"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {r.status === "pending" ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={setStatus.isPending}
                              onClick={() => setStatus.mutate({ id: r.id, status: "paid" })}
                            >
                              <Check className="mr-1 h-4 w-4" />
                              Paid
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={setStatus.isPending}
                              onClick={() => setStatus.mutate({ id: r.id, status: "cancelled" })}
                            >
                              <X className="mr-1 h-4 w-4" />
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={setStatus.isPending}
                            onClick={() => setStatus.mutate({ id: r.id, status: "pending" })}
                          >
                            Reopen
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
