import { createContext, useContext, type ReactNode } from "react";
import type { Database } from "@/integrations/supabase/types";

export type Role = Database["public"]["Enums"]["member_role"];
export type Business = Database["public"]["Tables"]["businesses"]["Row"];

type Ctx = { business: Business; role: Role; userId: string; email: string };
const BizCtx = createContext<Ctx | null>(null);

export function BusinessProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <BizCtx.Provider value={value}>{children}</BizCtx.Provider>;
}

export function useBusiness() {
  const c = useContext(BizCtx);
  if (!c) throw new Error("useBusiness outside provider");
  return c;
}

// UI hints only — real enforcement is in database policies.
const WRITE: Record<string, Role[]> = {
  catalog: ["owner", "manager", "store_keeper", "purchase_officer"],
  customers: ["owner", "manager", "salesman", "branch_manager", "accountant"],
  suppliers: ["owner", "manager", "purchase_officer", "accountant"],
  branches: ["owner", "manager"],
  team: ["owner"],
  deleteParty: ["owner", "manager"],
};
export function useCan(area: keyof typeof WRITE) {
  const { role } = useBusiness();
  return WRITE[area]?.includes(role) ?? false;
}
