import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { DEFAULT_COMPANY_NAME } from "./branding";
import { getSiteBranding } from "./branding.functions";

const BrandingContext = createContext({ name: DEFAULT_COMPANY_NAME });
export const useBranding = () => useContext(BrandingContext);
export function BrandingProvider({ children }: { children: ReactNode }) {
  const fetchBranding = useServerFn(getSiteBranding);
  const { data } = useQuery({
    queryKey: ["site-branding"],
    queryFn: () => fetchBranding(),
    refetchInterval: 60_000,
  });
  return (
    <BrandingContext.Provider value={data ?? { name: DEFAULT_COMPANY_NAME }}>
      {children}
    </BrandingContext.Provider>
  );
}
