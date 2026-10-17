import { createContext, useContext, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import {
  hasAccess,
  moduleForPath,
  type AccessAction,
  type AccessMatrix,
  type AccessModule,
} from "@/lib/access-control";

export type Role = Database["public"]["Enums"]["member_role"];
export type Business = Pick<
  Database["public"]["Tables"]["businesses"]["Row"],
  "id" | "name" | "phone" | "address" | "currency" | "type"
>;

type Ctx = {
  business: Business;
  role: Role;
  userId: string;
  email: string;
  access: AccessMatrix;
};
const BizCtx = createContext<Ctx | null>(null);

export function BusinessProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <BizCtx.Provider value={value}>{children}</BizCtx.Provider>;
}

export function useBusiness() {
  const c = useContext(BizCtx);
  if (!c) throw new Error("useBusiness outside provider");
  return c;
}

const WRITE: Record<string, AccessModule[]> = {
  catalog: ["products", "brands", "categories"],
  customers: ["customers"],
  suppliers: ["suppliers"],
  branches: ["branches"],
  team: ["team"],
  deleteParty: ["customers", "suppliers"],
};
export function useCan(area: keyof typeof WRITE, action?: AccessAction) {
  const { role, access } = useBusiness();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (role === "owner") return true;
  if (area === "team") return false;
  const currentModule = moduleForPath(pathname);
  const areaModules = WRITE[area] ?? [];
  const modules = areaModules.filter((module) => module === currentModule);
  const targets = modules.length ? modules : areaModules;
  return targets.some((module) =>
    action
      ? hasAccess(access, module, action)
      : area === "deleteParty"
        ? hasAccess(access, module, "delete")
        : hasAccess(access, module, "create") || hasAccess(access, module, "edit"),
  );
}
