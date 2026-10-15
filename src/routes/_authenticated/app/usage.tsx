import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { matchedCompany } from "@/lib/branding";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { summarizeVisits } from "@/lib/visits";

export const Route = createFileRoute("/_authenticated/app/usage")({
  head: ({ matches }) => ({
    meta: [
      { title: `Visitors & Usage Log — ${matchedCompany(matches)}` },
      { name: "description", content: `Who used ${matchedCompany(matches)} and which pages they opened.` },
      { property: "og:title", content: `Visitors & Usage Log — ${matchedCompany(matches)}` },
      { property: "og:description", content: `Who used ${matchedCompany(matches)} and which pages they opened.` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UsagePage,
});

function UsagePage() {
  const { business, role } = useBusiness();
  const [days, setDays] = useState(7);
  const from = useMemo(() => new Date(Date.now() - days * 864e5).toISOString(), [days]);
  const q = useQuery({
    queryKey: ["visit_log", business.id, days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("visit_log", { _biz: business.id, _from: from });
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = q.data ?? [];
  const s = summarizeVisits(rows);
  if (role !== "owner" && role !== "manager") return <p className="text-sm text-muted-foreground">Only the owner or manager can see the usage log.</p>;
  return (
    <div className="space-y-5">
      <PageHeader title="Visitors & usage log · ভিজিটর ও ব্যবহার লগ" sub="Every page opened inside the app by signed-in staff, with time and device." />
      <div className="flex gap-2">
        {[1, 7, 30].map((d) => <Button key={d} size="sm" variant={d === days ? "default" : "outline"} onClick={() => setDays(d)}>{d === 1 ? "Today" : `Last ${d} days`}</Button>)}
      </div>
      {q.error && <p className="text-sm text-destructive">{friendlyError(q.error)}</p>}
      <div className="grid gap-3 sm:grid-cols-4">
        {[["Page views", s.views], ["Visits (sessions)", s.sessions], ["People", s.people], ["Pages used", s.pages.length]].map(([l, v]) => (
          <Card key={l}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="text-2xl font-bold">{v}</p></CardContent></Card>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardContent className="p-4"><p className="mb-2 font-semibold">Pages used</p>
          <Table><TableHeader><TableRow><TableHead>Page</TableHead><TableHead className="text-right">Views</TableHead></TableRow></TableHeader>
            <TableBody>{s.pages.map(([p, n]) => <TableRow key={p}><TableCell>{p}</TableCell><TableCell className="text-right">{n}</TableCell></TableRow>)}</TableBody></Table>
        </CardContent></Card>
        <Card><CardContent className="p-4"><p className="mb-2 font-semibold">People</p>
          <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="text-right">Views</TableHead><TableHead>Last seen</TableHead></TableRow></TableHeader>
            <TableBody>{s.users.map((u) => <TableRow key={u.name}><TableCell>{u.name}</TableCell><TableCell className="text-right">{u.views}</TableCell><TableCell className="text-xs">{new Date(u.last).toLocaleString("en-GB")}</TableCell></TableRow>)}</TableBody></Table>
        </CardContent></Card>
      </div>
      <Card><CardContent className="p-4"><p className="mb-2 font-semibold">Full log ({rows.length})</p>
        <Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Person</TableHead><TableHead>Page</TableHead><TableHead>Device</TableHead><TableHead>Visit</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((r, i) => (
            <TableRow key={i}><TableCell className="whitespace-nowrap text-xs">{new Date(r.visited_at).toLocaleString("en-GB")}</TableCell><TableCell>{r.user_name}</TableCell><TableCell>{r.path}</TableCell><TableCell>{r.device}</TableCell><TableCell className="font-mono text-xs">{r.session_id.slice(0, 8)}</TableCell></TableRow>
          ))}</TableBody></Table>
      </CardContent></Card>
      <p className="text-xs text-muted-foreground">Recording started on 12 Oct 2026. The public homepage and login page (before sign-in) are counted separately in the site analytics.</p>
    </div>
  );
}
