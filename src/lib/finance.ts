import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useMoneyAccounts(bizId: string) {
  return useQuery({
    queryKey: ["money_accounts", bizId],
    queryFn: async () => {
      const { data, error } = await supabase.from("money_account_balances").select("*").eq("business_id", bizId).order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useBranches(bizId: string) {
  return useQuery({
    queryKey: ["branches-lite", bizId],
    queryFn: async () => {
      const { data, error } = await supabase.from("branches").select("id,name,kind").eq("business_id", bizId).eq("status", "active").order("name");
      if (error) throw error;
      return data;
    },
  });
}

export const FINANCE_ROLES = ["owner", "manager", "accountant"];
