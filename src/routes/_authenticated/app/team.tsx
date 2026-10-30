import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness, type Role } from "@/lib/business";
import { ACCESS_ACTIONS, hasAccess } from "@/lib/access-control";
import { useI18n } from "@/lib/i18n";
import { ROLE_LABELS, friendlyError } from "@/lib/format";
import { addMemberByEmail } from "@/lib/team.functions";
import { effectiveModulePermissions, SHOP_PERMISSION_MODULES } from "@/lib/team-shop-access";
import { PageHeader } from "@/components/erp/EntityManager";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
const SHOP_STAFF_ROLES: Role[] = ["branch_manager", "salesman", "store_keeper", "purchase_officer"];

function TeamPage() {
  const { business, userId, access, role: currentRole } = useBusiness();
  const { t } = useI18n();
  const isOwner = currentRole === "owner";
  const canManageShopAccess =
    isOwner ||
    (currentRole === "manager" &&
      hasAccess(access, "sales", "view") &&
      (hasAccess(access, "sales", "create") || hasAccess(access, "sales", "edit")));
  const canNotify = hasAccess(access, "team", "create");
  const qc = useQueryClient();
  const add = useServerFn(addMemberByEmail);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("salesman");
  const [notifyTo, setNotifyTo] = useState<{ user_id: string; name: string } | null>(null);
  const [nTitle, setNTitle] = useState("");
  const [nMessage, setNMessage] = useState("");
  const [advancedAccess, setAdvancedAccess] = useState(false);
  const [shopMemberId, setShopMemberId] = useState("");

  const { data } = useQuery({
    queryKey: ["members", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_members")
        .select("id,user_id,role,display_name,access_role_id")
        .eq("business_id", business.id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const shops = useQuery({
    enabled: canManageShopAccess,
    queryKey: ["team-shop-branches", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id,name,kind")
        .eq("business_id", business.id)
        .eq("status", "active")
        .eq("kind", "branch")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const shopAssignments = useQuery({
    enabled: canManageShopAccess,
    queryKey: ["team-shop-access", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_finance_branch_access")
        .select("user_id,branch_id")
        .eq("business_id", business.id);
      if (error) throw error;
      return data;
    },
  });

  const memberPermissions = useQuery({
    enabled: isOwner,
    queryKey: ["team-member-permissions", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_access_permissions")
        .select("access_role_id,user_id,module,permission,allowed")
        .eq("business_id", business.id);
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

  const assignShop = useMutation({
    mutationFn: async ({
      userId: targetUserId,
      branchId,
      enabled,
    }: {
      userId: string;
      branchId: string;
      enabled: boolean;
    }) => {
      const { error } = await supabase.rpc("assign_partner_finance_branch_access", {
        _biz: business.id,
        _user: targetUserId,
        _branch: branchId,
        _enabled: enabled,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Shop access updated");
      void qc.invalidateQueries({ queryKey: ["team-shop-access", business.id] });
    },
    onError: (error) => toast.error(friendlyError(error)),
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
  const shopMember = data?.find((member) => member.id === shopMemberId);
  return (
    <div>
      <PageHeader
        title={t("team")}
        sub="Each user gets one role. Permissions are enforced on the server."
      />
      {isOwner && (
        <section className="mb-6 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-semibold">Advanced access</h2>
              <p className="text-sm text-muted-foreground">
                Configure custom roles and per-user page and action permissions.
              </p>
            </div>
            <Switch
              checked={advancedAccess}
              onCheckedChange={setAdvancedAccess}
              aria-label="Show advanced access controls"
            />
          </div>
          {advancedAccess && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="max-w-2xl text-sm text-muted-foreground">
                Members without an assigned access role or individual grants are denied by default.
                The business owner always retains full access.
              </p>
              <Button asChild>
                <Link to="/app/access-control">Manage access rules</Link>
              </Button>
            </div>
          )}
        </section>
      )}
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
              {canManageShopAccess && <TableHead>Shop access</TableHead>}
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
                {canManageShopAccess && (
                  <TableCell>
                    {SHOP_STAFF_ROLES.includes(m.role) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShopMemberId(m.id)}
                        disabled={shops.isLoading || shopAssignments.isLoading}
                      >
                        Manage shops
                        {shopAssignments.data && (
                          <span className="ml-1 text-muted-foreground">
                            (
                            {
                              shopAssignments.data.filter((entry) => entry.user_id === m.user_id)
                                .length
                            }
                            )
                          </span>
                        )}
                      </Button>
                    ) : (
                      <span className="text-sm text-muted-foreground">Not shop-scoped</span>
                    )}
                  </TableCell>
                )}
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

      <Dialog open={!!shopMember} onOpenChange={(open) => !open && setShopMemberId("")}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Shop access — {shopMember?.display_name ?? ROLE_LABELS[shopMember?.role ?? "viewer"]}
            </DialogTitle>
          </DialogHeader>
          {shopMember && (
            <div className="space-y-6">
              <section className="space-y-3">
                <div>
                  <h3 className="font-medium">Assigned shops</h3>
                  <p className="text-sm text-muted-foreground">
                    Shop assignment limits this member's sales, stock, customer, and closing data to
                    the selected shops.
                  </p>
                </div>
                {shops.error || shopAssignments.error ? (
                  <p className="text-sm text-destructive">
                    {friendlyError(shops.error ?? shopAssignments.error)}
                  </p>
                ) : shops.isLoading || shopAssignments.isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading shop access…</p>
                ) : shops.data?.length ? (
                  <div className="space-y-2">
                    {shops.data.map((shop) => {
                      const assigned = (shopAssignments.data ?? []).some(
                        (entry) =>
                          entry.user_id === shopMember.user_id && entry.branch_id === shop.id,
                      );
                      return (
                        <Label
                          key={shop.id}
                          className="flex items-center gap-3 rounded-md border p-3"
                        >
                          <Checkbox
                            checked={assigned}
                            disabled={assignShop.isPending}
                            onCheckedChange={(checked) =>
                              assignShop.mutate({
                                userId: shopMember.user_id,
                                branchId: shop.id,
                                enabled: checked === true,
                              })
                            }
                          />
                          <span>{shop.name}</span>
                        </Label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No active brand shops. Create a shop before assigning staff.
                  </p>
                )}
              </section>

              <section className="space-y-3 border-t pt-4">
                <div>
                  <h3 className="font-medium">Module permissions</h3>
                  <p className="text-sm text-muted-foreground">
                    These permissions apply to every assigned shop; shop assignment still restricts
                    which shop data the member can access.
                  </p>
                </div>
                {isOwner ? (
                  memberPermissions.error ? (
                    <p className="text-sm text-destructive">
                      {friendlyError(memberPermissions.error)}
                    </p>
                  ) : memberPermissions.isLoading ? (
                    <p className="text-sm text-muted-foreground">Loading permissions…</p>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {SHOP_PERMISSION_MODULES.map(({ module, label }) => {
                        const actions = effectiveModulePermissions(
                          shopMember,
                          memberPermissions.data ?? [],
                          module,
                        );
                        const actionLabels = ACCESS_ACTIONS.filter(({ key }) =>
                          actions.includes(key),
                        ).map(({ label: actionLabel }) => actionLabel);
                        return (
                          <li key={module} className="rounded-md border p-3 text-sm">
                            <span className="font-medium">{label}: </span>
                            <span className="text-muted-foreground">
                              {actionLabels.length ? actionLabels.join(", ") : "No permissions"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Detailed module permissions can be viewed by the business owner in Advanced
                    access.
                  </p>
                )}
                {isOwner && (
                  <Button asChild size="sm" variant="outline">
                    <Link to="/app/access-control">Configure module permissions</Link>
                  </Button>
                )}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
