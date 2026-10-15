import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { GuardianSnapshot } from "./types";

export const guardianQuery = (businessId: string) =>
  queryOptions({
    queryKey: ["guardian-snapshot", businessId],
    refetchInterval: 60_000,
    // Shared by owner, chat, anomalies and settings pages: reuse instantly while refreshing quietly.
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("guardian_snapshot", { _biz: businessId });
      if (error) throw error;
      return data as unknown as GuardianSnapshot;
    },
  });
