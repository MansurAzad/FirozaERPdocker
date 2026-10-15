import { matchedCompany } from "@/lib/branding";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { useBusiness } from "@/lib/business";
import { guardianQuery } from "@/lib/guardian/queries";
import { profileSchema } from "@/lib/guardian/safety";
import { saveGuardianProfile } from "@/lib/guardian.functions";
import { GuardianNav } from "@/components/erp/GuardianNav";
import { PageHeader } from "@/components/erp/EntityManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError } from "@/lib/format";
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
  loader: ({ context }) => context.queryClient.ensureQueryData(guardianQuery(context.business.id)),
  component: ProfilePage,
});
function ProfilePage() {
  const { business, role } = useBusiness();
  const { data } = useSuspenseQuery(guardianQuery(business.id));
  const qc = useQueryClient();
  const router = useRouter();
  const save = useServerFn(saveGuardianProfile);
  const [form, setForm] = useState({
    name: data.company.name,
    phone: data.company.phone ?? "",
    address: data.company.address ?? "",
    trade_license: data.company.trade_license ?? "",
    guardian_profile: {
      contact_person: data.company.profile["contact_person"] ?? "",
      email: data.company.profile["email"] ?? "",
      website: data.company.profile["website"] ?? "",
      business_hours: data.company.profile["business_hours"] ?? "",
      notes: data.company.profile["notes"] ?? "",
    },
  });
  const mutation = useMutation({
    mutationFn: () =>
      save({ data: { businessId: business.id, profile: profileSchema.parse(form) } }),
    onSuccess: async () => {
      await qc.invalidateQueries();
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
        sub={data.company.currency + " · " + data.company.type}
      />
      <form
        className="max-w-3xl space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          {(
            [
              ["name", "Company name"],
              ["phone", "Phone"],
              ["address", "Address"],
              ["trade_license", "Trade license"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <Label htmlFor={key}>{label}</Label>
              <Input
                id={key}
                required={key === "name"}
                maxLength={key === "address" ? 500 : 120}
                value={form[key]}
                disabled={role !== "owner"}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
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
                maxLength={300}
                value={form.guardian_profile[key]}
                disabled={role !== "owner"}
                onChange={(e) =>
                  setForm({
                    ...form,
                    guardian_profile: { ...form.guardian_profile, [key]: e.target.value },
                  })
                }
              />
            </div>
          ))}
        </div>
        <div>
          <Label htmlFor="company-notes">Business context</Label>
          <Textarea
            id="company-notes"
            maxLength={2000}
            value={form.guardian_profile.notes}
            disabled={role !== "owner"}
            onChange={(e) =>
              setForm({
                ...form,
                guardian_profile: { ...form.guardian_profile, notes: e.target.value },
              })
            }
          />
        </div>
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
