import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness, useCan, type Role } from "@/lib/business";
import { useI18n } from "@/lib/i18n";
import { ROLE_LABELS, friendlyError } from "@/lib/format";
import { addMemberByEmail } from "@/lib/team.functions";
import { PageHeader } from "@/components/erp/EntityManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/team")({
  head: ({ matches }) => ({
    meta: [
      { title: `Users & Roles — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Users & Roles records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Users & Roles — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Users & Roles records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TeamPage,
});

const ASSIGNABLE = Object.keys(ROLE_LABELS).filter((r) => r !== "owner") as Exclude<
  Role,
  "owner"
>[];

function TeamPage() {
  const { business, userId, role: accountRole } = useBusiness();
  const { t } = useI18n();
  const isOwner = useCan("team");
  const canNotify = accountRole === "owner" || accountRole === "manager";
  const qc = useQueryClient();
  const add = useServerFn(addMemberByEmail);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("salesman");
  const [notifyTo, setNotifyTo] = useState<{ user_id: string; name: string } | null>(null);
  const [nTitle, setNTitle] = useState("");
  const [nMessage, setNMessage] = useState("");

  const { data } = useQuery({
    queryKey: ["members", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_members")
        .select("*")
        .eq("business_id", business.id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const addM = useMutation({
    mutationFn: () => add({ data: { businessId: business.id, email: email.trim(), role } }),
    onSuccess: (r) => {
      if (!r.ok) return void toast.error(r.message);
      toast.success("User added");
      setEmail("");
      qc.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const update = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: Role }) => {
      const { error } = await supabase.from("business_members").update({ role }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("business_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const notify = useMutation({
    mutationFn: async () => {
      if (!notifyTo) return;
      const { error } = await supabase.rpc("create_notification", {
        _biz: business.id,
        _user_id: notifyTo.user_id,
        _title: nTitle.trim(),
        _message: nMessage.trim(),
        _type: "info",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Notification sent");
      setNotifyTo(null);
      setNTitle("");
      setNMessage("");
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const sel = "h-9 rounded-md border border-input bg-background px-3 text-sm";
  return (
    <div>
      <PageHeader
        title={t("team")}
        sub="Each user gets one role. Permissions are enforced on the server."
      />
      {isOwner && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addM.mutate();
          }}
          className="mb-6 flex flex-wrap gap-2 rounded-lg border bg-card p-4"
        >
          <Input
            type="email"
            required
            placeholder="staff@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="max-w-xs"
          />
          <select
            className={sel}
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            {ASSIGNABLE.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <Button disabled={addM.isPending}>Add user</Button>
        </form>
      )}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((m) => (
              <TableRow key={m.id}>
                <TableCell>{m.user_id === userId ? "You" : m.display_name}</TableCell>
                <TableCell>
                  {isOwner && m.role !== "owner" ? (
                    <select
                      className={sel}
                      value={m.role}
                      onChange={(e) => update.mutate({ id: m.id, role: e.target.value as Role })}
                    >
                      {ASSIGNABLE.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    ROLE_LABELS[m.role]
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {canNotify && m.user_id !== userId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setNotifyTo({
                            user_id: m.user_id,
                            name: m.user_id === userId ? "You" : (m.display_name ?? "Team member"),
                          })
                        }
                      >
                        Notify
                      </Button>
                    )}
                    {isOwner && m.role !== "owner" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => confirm("Remove this user?") && remove.mutate(m.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!notifyTo} onOpenChange={(o) => !o && setNotifyTo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notify {notifyTo?.name}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              notify.mutate();
            }}
          >
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Title *</label>
              <Input value={nTitle} onChange={(e) => setNTitle(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Message *</label>
              <Textarea
                value={nMessage}
                onChange={(e) => setNMessage(e.target.value)}
                rows={3}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNotifyTo(null)}>
                Cancel
              </Button>
              <Button disabled={notify.isPending || !nTitle.trim() || !nMessage.trim()}>
                Send
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
