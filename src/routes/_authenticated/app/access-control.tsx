import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { friendlyError } from "@/lib/format";
import {
  ACCESS_ACTIONS,
  ACCESS_MODULES,
  type AccessAction,
  type AccessMatrix,
  type AccessModule,
} from "@/lib/access-control";
import { PageHeader } from "@/components/erp/EntityManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type PermissionRow = {
  access_role_id: string | null;
  allowed: boolean;
  module: string;
  permission: string;
  user_id: string | null;
};

type AccessRole = {
  id: string;
  name: string;
  description: string;
};

type Member = {
  id: string;
  user_id: string;
  role: string;
  display_name: string | null;
  access_role_id: string | null;
};

function matrixFromRows(rows: PermissionRow[]): AccessMatrix {
  const matrix: AccessMatrix = {};
  for (const row of rows) {
    if (row.allowed) {
      const module = row.module as AccessModule;
      const action = row.permission as AccessAction;
      matrix[module] = { ...matrix[module], [action]: true };
    }
  }
  return matrix;
}

function matrixRows(matrix: AccessMatrix) {
  return ACCESS_MODULES.flatMap(({ key: module }) =>
    ACCESS_ACTIONS.map(({ key: permission }) => ({
      module,
      permission,
      allowed: matrix[module]?.[permission] === true,
    })),
  );
}

function ModuleMatrix({
  value,
  onChange,
}: {
  value: AccessMatrix;
  onChange: (value: AccessMatrix) => void;
}) {
  function setPermission(module: AccessModule, action: AccessAction, allowed: boolean) {
    const next = { ...value, [module]: { ...value[module], [action]: allowed } };
    if (action === "view" && !allowed) {
      next[module] = Object.fromEntries(
        ACCESS_ACTIONS.map(({ key }) => [key, false]),
      ) as NonNullable<AccessMatrix[AccessModule]>;
    } else if (action !== "view" && allowed) {
      next[module] = { ...next[module], view: true };
    }
    onChange(next);
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-muted/60 text-left">
          <tr>
            <th className="sticky left-0 bg-muted/90 px-3 py-2">Page / module</th>
            {ACCESS_ACTIONS.map((action) => (
              <th key={action.key} className="px-2 py-2 text-center">
                {action.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ACCESS_MODULES.map((module) => (
            <tr key={module.key} className="border-t">
              <th className="sticky left-0 bg-card px-3 py-2 text-left font-medium">
                {module.label}
              </th>
              {ACCESS_ACTIONS.map((action) => (
                <td key={action.key} className="px-2 py-2 text-center">
                  <Switch
                    checked={value[module.key]?.[action.key] === true}
                    onCheckedChange={(checked) => setPermission(module.key, action.key, checked)}
                    aria-label={`${module.label}: ${action.label}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/app/access-control")({
  head: ({ matches }) => ({
    meta: [{ title: `Advanced access — ${matchedCompany(matches)}` }],
  }),
  component: AccessControlPage,
});

function AccessControlPage() {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const [roleId, setRoleId] = useState("");
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [roleMatrix, setRoleMatrix] = useState<AccessMatrix>({});
  const [memberId, setMemberId] = useState("");
  const [memberRoleId, setMemberRoleId] = useState("");
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [memberMatrix, setMemberMatrix] = useState<AccessMatrix>({});

  const roles = useQuery({
    enabled: role === "owner",
    queryKey: ["access-roles", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("access_roles")
        .select("id,name,description")
        .eq("business_id", business.id)
        .order("name");
      if (error) throw error;
      return data as AccessRole[];
    },
  });
  const members = useQuery({
    enabled: role === "owner",
    queryKey: ["access-members", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_members")
        .select("id,user_id,role,display_name,access_role_id")
        .eq("business_id", business.id)
        .neq("role", "owner")
        .order("created_at");
      if (error) throw error;
      return data as Member[];
    },
  });
  const permissions = useQuery({
    enabled: role === "owner",
    queryKey: ["access-permissions", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_access_permissions")
        .select("access_role_id,user_id,module,permission,allowed")
        .eq("business_id", business.id);
      if (error) throw error;
      return data as PermissionRow[];
    },
  });

  useEffect(() => {
    if (!roleId && roles.data?.[0]) setRoleId(roles.data[0].id);
  }, [roleId, roles.data]);

  useEffect(() => {
    const selected = roles.data?.find((item) => item.id === roleId);
    setRoleName(selected?.name ?? "");
    setRoleDescription(selected?.description ?? "");
    setRoleMatrix(
      matrixFromRows((permissions.data ?? []).filter((item) => item.access_role_id === roleId)),
    );
  }, [roleId, roles.data, permissions.data]);

  useEffect(() => {
    const member = members.data?.find((item) => item.id === memberId);
    const memberOverrides = (permissions.data ?? []).filter(
      (item) => item.user_id === member?.user_id,
    );
    const selectedRoleId = member?.access_role_id ?? "";
    const inherited = (permissions.data ?? []).filter(
      (item) => item.access_role_id === selectedRoleId,
    );
    setMemberRoleId(selectedRoleId);
    setOverrideEnabled(memberOverrides.length > 0);
    const combined = matrixFromRows(inherited);
    if (memberOverrides.length) {
      for (const override of memberOverrides) {
        const module = override.module as AccessModule;
        const permission = override.permission as AccessAction;
        combined[module] = { ...combined[module], [permission]: override.allowed };
      }
    }
    setMemberMatrix(combined);
  }, [memberId, members.data, permissions.data]);

  const saveRole = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("save_access_role", {
        _biz: business.id,
        _role_id: roleId || null,
        _name: roleName,
        _description: roleDescription,
        _permissions: matrixRows(roleMatrix),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (savedId) => {
      setRoleId(savedId);
      toast.success("Access role saved");
      void qc.invalidateQueries({ queryKey: ["access-roles", business.id] });
      void qc.invalidateQueries({ queryKey: ["access-permissions", business.id] });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const saveMember = useMutation({
    mutationFn: async () => {
      const member = members.data?.find((item) => item.id === memberId);
      if (!member) throw new Error("Select a team member.");
      const { error } = await supabase.rpc("save_member_access", {
        _biz: business.id,
        _user: member.user_id,
        _role_id: memberRoleId || null,
        _overrides: overrideEnabled ? matrixRows(memberMatrix) : [],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Member access saved");
      void qc.invalidateQueries({ queryKey: ["access-members", business.id] });
      void qc.invalidateQueries({ queryKey: ["access-permissions", business.id] });
      void qc.invalidateQueries({ queryKey: ["effective-access", business.id] });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const deleteRole = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("delete_access_role", {
        _biz: business.id,
        _role_id: roleId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setRoleId("");
      toast.success("Access role deleted");
      void qc.invalidateQueries({ queryKey: ["access-roles", business.id] });
      void qc.invalidateQueries({ queryKey: ["access-permissions", business.id] });
      void qc.invalidateQueries({ queryKey: ["access-members", business.id] });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  if (role !== "owner") {
    return (
      <div>
        <PageHeader title="Advanced access" />
        <p className="text-sm text-destructive">Only the business owner can manage access rules.</p>
      </div>
    );
  }

  const selectedMember = members.data?.find((member) => member.id === memberId);

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Advanced access"
        sub="Custom roles and per-user overrides control page visibility and data actions."
      />
      <section className="space-y-4 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Custom roles</h2>
            <p className="text-sm text-muted-foreground">
              Unconfigured permissions are denied. The owner always has full access.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="h-9 max-w-full rounded-md border bg-background px-3 text-sm"
              value={roleId}
              onChange={(event) => setRoleId(event.target.value)}
            >
              <option value="">Create a role...</option>
              {(roles.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <Button variant="outline" onClick={() => setRoleId("")} type="button">
              New role
            </Button>
          </div>
        </div>
        {roles.error || permissions.error ? (
          <p className="text-sm text-destructive">
            {friendlyError(roles.error ?? permissions.error)}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                value={roleName}
                onChange={(event) => setRoleName(event.target.value)}
                placeholder="Role name"
                maxLength={80}
              />
              <Textarea
                value={roleDescription}
                onChange={(event) => setRoleDescription(event.target.value)}
                placeholder="Description (optional)"
                rows={2}
              />
            </div>
            <ModuleMatrix value={roleMatrix} onChange={setRoleMatrix} />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => saveRole.mutate()}
                disabled={saveRole.isPending || !roleName.trim()}
              >
                Save role
              </Button>
              {roleId && (
                <Button
                  variant="destructive"
                  onClick={() => deleteRole.mutate()}
                  disabled={deleteRole.isPending}
                >
                  Delete role
                </Button>
              )}
            </div>
          </>
        )}
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-4">
        <div>
          <h2 className="font-semibold">User access distribution</h2>
          <p className="text-sm text-muted-foreground">
            Assign one role profile, then optionally override its permissions for an individual.
          </p>
        </div>
        {members.error ? (
          <p className="text-sm text-destructive">{friendlyError(members.error)}</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm"
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
              >
                <option value="">Select a team member...</option>
                {(members.data ?? []).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.display_name || member.user_id} — {member.role}
                  </option>
                ))}
              </select>
              <select
                className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm"
                value={memberRoleId}
                onChange={(event) => {
                  const nextRoleId = event.target.value;
                  setMemberRoleId(nextRoleId);
                  if (!overrideEnabled) {
                    setMemberMatrix(
                      matrixFromRows(
                        (permissions.data ?? []).filter(
                          (item) => item.access_role_id === nextRoleId,
                        ),
                      ),
                    );
                  }
                }}
                disabled={!selectedMember}
              >
                <option value="">No custom role (deny by default)</option>
                {(roles.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div className="min-w-0">
                <div className="font-medium">Individual permission overrides</div>
                <p className="text-sm text-muted-foreground">
                  Turn on to replace inherited permissions for this member only.
                </p>
              </div>
              <Switch
                checked={overrideEnabled}
                disabled={!selectedMember}
                onCheckedChange={(enabled) => {
                  setOverrideEnabled(enabled);
                  if (!enabled) {
                    setMemberMatrix(
                      matrixFromRows(
                        (permissions.data ?? []).filter(
                          (item) => item.access_role_id === memberRoleId,
                        ),
                      ),
                    );
                  }
                }}
                aria-label="Enable individual access overrides"
              />
            </div>
            {overrideEnabled && <ModuleMatrix value={memberMatrix} onChange={setMemberMatrix} />}
            <Button
              onClick={() => saveMember.mutate()}
              disabled={saveMember.isPending || !selectedMember}
            >
              Save member access
            </Button>
          </>
        )}
      </section>
    </div>
  );
}
