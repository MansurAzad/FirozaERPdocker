import { describe, expect, it } from "vitest";
import { effectiveModulePermissions, type MemberPermissionRow } from "./team-shop-access";

const member = { user_id: "staff-1", role: "branch_manager", access_role_id: "role-1" };

describe("effectiveModulePermissions", () => {
  it("uses the assigned access role when no per-user override exists", () => {
    const rows: MemberPermissionRow[] = [
      {
        access_role_id: "role-1",
        allowed: true,
        module: "sales",
        permission: "view",
        user_id: null,
      },
      {
        access_role_id: "role-1",
        allowed: true,
        module: "sales",
        permission: "create",
        user_id: null,
      },
    ];

    expect(effectiveModulePermissions(member, rows, "sales")).toEqual(["view", "create"]);
  });

  it("lets a per-user denial override an inherited grant", () => {
    const rows: MemberPermissionRow[] = [
      {
        access_role_id: "role-1",
        allowed: true,
        module: "closing",
        permission: "view",
        user_id: null,
      },
      {
        access_role_id: null,
        allowed: false,
        module: "closing",
        permission: "view",
        user_id: "staff-1",
      },
    ];

    expect(effectiveModulePermissions(member, rows, "closing")).toEqual([]);
  });

  it("defaults unconfigured permissions to denied and gives the owner full access", () => {
    expect(effectiveModulePermissions(member, [], "customers")).toEqual([]);
    expect(effectiveModulePermissions({ ...member, role: "owner" }, [], "customers")).toEqual([
      "view",
      "create",
      "edit",
      "delete",
      "approve",
      "export",
    ]);
  });

  it("does not report write access when view access is denied", () => {
    const rows: MemberPermissionRow[] = [
      {
        access_role_id: "role-1",
        allowed: false,
        module: "inventory",
        permission: "view",
        user_id: null,
      },
      {
        access_role_id: "role-1",
        allowed: true,
        module: "inventory",
        permission: "create",
        user_id: null,
      },
    ];

    expect(effectiveModulePermissions(member, rows, "inventory")).toEqual([]);
  });
});
