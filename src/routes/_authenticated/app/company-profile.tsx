import { matchedCompany } from "@/lib/branding";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, ContactRound, FileText, Save } from "lucide-react";
import { useBusiness } from "@/lib/business";
import { profileSchema } from "@/lib/guardian/safety";
import { saveGuardianProfile } from "@/lib/guardian.functions";
import { GuardianNav } from "@/components/erp/GuardianNav";
import { PageHeader } from "@/components/erp/EntityManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";

type CompanyProfileForm = ReturnType<typeof companyProfileForm>;
type CompanyProfileRow = {
  name: string;
  phone: string | null;
  address: string | null;
  trade_license?: string | null;
  guardian_profile?: unknown;
};
const companyProfileRowSchema = z.object({
  name: z.string(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  trade_license: z.string().nullable(),
  guardian_profile: z.unknown(),
});

function companyProfileForm(company: CompanyProfileRow) {
  const isProfileObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const profile = isProfileObject(company.guardian_profile) ? company.guardian_profile : {};
  const text = (key: string) => (typeof profile[key] === "string" ? profile[key] : "");
  return {
    name: company.name,
    phone: company.phone ?? "",
    address: company.address ?? "",
    trade_license: company.trade_license ?? "",
    guardian_profile: {
      contact_person: text("contact_person"),
      email: text("email"),
      website: text("website"),
      business_hours: text("business_hours"),
      notes: text("notes"),
    },
  };
}

const companyProfileKey = (businessId: string) => ["company-profile", businessId] as const;

export const Route = createFileRoute("/_authenticated/app/company-profile")({
  head: ({ matches }) => ({
    meta: [
      { title: `Company Profile — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: "Company identity, contact details and owner-approved business context.",
      },
      { property: "og:title", content: `Company Profile — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "Manage company contact information and Guardian context.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});
function ProfilePage() {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const router = useRouter();
  const save = useServerFn(saveGuardianProfile);
  const [form, setForm] = useState<CompanyProfileForm>(() =>
    companyProfileForm({
      name: business.name,
      phone: business.phone,
      address: business.address,
    }),
  );
  const [dirty, setDirty] = useState(false);
  const profileQuery = useQuery({
    queryKey: companyProfileKey(business.id),
    initialData: () => companyProfileForm(business),
    staleTime: 30_000,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_company_profile", { _biz: business.id });
      if (error) throw error;
      return companyProfileForm(companyProfileRowSchema.parse(data));
    },
  });
  useEffect(() => {
    if (!dirty) setForm(profileQuery.data);
  }, [dirty, profileQuery.data]);
  const mutation = useMutation({
    mutationFn: () => {
      const profile = profileSchema.parse(form);
      return save({ data: { businessId: business.id, profile } }).then(() => profile);
    },
    onSuccess: async (profile) => {
      qc.setQueryData(companyProfileKey(business.id), profile);
      setForm(profile);
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["guardian-snapshot", business.id] });
      await router.invalidate();
      toast.success("Company profile saved");
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <div>
      <GuardianNav />
      <PageHeader
        title="Settings · Company & branding"
        sub={business.currency + " · " + business.type}
      />
      <nav aria-label="Company settings sections" className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          ["company-details", "Company details", Building2],
          ["contact-details", "Contact details", ContactRound],
          ["business-context", "Business context", FileText],
        ].map(([id, label, Icon]) => {
          const SectionIcon = Icon as typeof Building2;
          return (
            <Button
              key={id as string}
              asChild
              variant="outline"
              className="h-14 justify-start gap-3 text-left"
            >
              <a href={`#${id as string}`}>
                <SectionIcon className="h-5 w-5 shrink-0" />
                {label as string}
              </a>
            </Button>
          );
        })}
      </nav>
      {profileQuery.error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          Could not refresh company settings: {friendlyError(profileQuery.error)}
        </p>
      )}
      <form
        className="w-full max-w-3xl space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <section id="company-details" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold">Company details</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {(
              [
                ["name", "Company name"],
                ["trade_license", "Trade license"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <Label htmlFor={key}>{label}</Label>
                <Input
                  id={key}
                  required={key === "name"}
                  maxLength={key === "trade_license" ? 100 : 120}
                  value={form[key]}
                  disabled={role !== "owner"}
                  onChange={(e) => {
                    setDirty(true);
                    setForm({ ...form, [key]: e.target.value });
                  }}
                />
              </div>
            ))}
          </div>
        </section>
        <section id="contact-details" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold">Contact details</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {(
              [
                ["phone", "Phone"],
                ["address", "Address"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <Label htmlFor={key}>{label}</Label>
                <Input
                  id={key}
                  maxLength={key === "address" ? 500 : 30}
                  value={form[key]}
                  disabled={role !== "owner"}
                  onChange={(e) => {
                    setDirty(true);
                    setForm({ ...form, [key]: e.target.value });
                  }}
                />
              </div>
            ))}
            {(
              [
                ["contact_person", "Contact person"],
                ["email", "Email"],
                ["website", "Website"],
                ["business_hours", "Business hours"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <Label htmlFor={key}>{label}</Label>
                <Input
                  id={key}
                  type={key === "email" ? "email" : key === "website" ? "url" : "text"}
                  maxLength={
                    key === "contact_person"
                      ? 100
                      : key === "email"
                        ? 200
                        : key === "website"
                          ? 300
                          : 200
                  }
                  value={form.guardian_profile[key]}
                  disabled={role !== "owner"}
                  onChange={(e) => {
                    setDirty(true);
                    setForm({
                      ...form,
                      guardian_profile: { ...form.guardian_profile, [key]: e.target.value },
                    });
                  }}
                />
              </div>
            ))}
          </div>
        </section>
        <section id="business-context" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-semibold">Business context</h2>
          <div>
            <Label htmlFor="company-notes">Business context</Label>
            <Textarea
              id="company-notes"
              maxLength={2000}
              value={form.guardian_profile.notes}
              disabled={role !== "owner"}
              onChange={(e) => {
                setDirty(true);
                setForm({
                  ...form,
                  guardian_profile: { ...form.guardian_profile, notes: e.target.value },
                });
              }}
            />
          </div>
        </section>
        <Button type="submit" disabled={role !== "owner" || mutation.isPending}>
          <Save />
          {mutation.isPending ? "Saving…" : "Save company profile"}
        </Button>
        {role !== "owner" && (
          <p className="text-sm text-muted-foreground">
            Only the owner can change company details.
          </p>
        )}
      </form>
    </div>
  );
}
