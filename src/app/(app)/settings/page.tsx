import { createClient, requireProfile } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { OrgForm, PasswordForm, ProfileForm, ServicesEditor, TemplatesEditor } from "./forms";

export default async function SettingsPage() {
  const me = await requireProfile();
  const supabase = createClient();
  const [{ data: profile }, { data: templates }, { data: org }, { data: services }, { data: settings }] = await Promise.all([
    supabase.from("profiles").select("full_name,phone,email").eq("id", me.id).single(),
    supabase.from("message_templates").select("id,name,category,body,is_active").order("name"),
    supabase.from("organizations").select("*").limit(1).maybeSingle(),
    me.role === "admin" ? supabase.from("services").select("id,name,category,description,base_price,is_active").order("sort_order") : Promise.resolve({ data: null }),
    supabase.from("system_settings").select("value").eq("key", "company").maybeSingle(),
  ]);
  const defaultTax = Number((settings?.value as { default_tax_rate?: number } | null)?.default_tax_rate ?? 0);
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileForm profile={profile ?? { full_name: me.full_name, phone: null, email: me.email }} />
        <PasswordForm />
      </div>
      <div className="mt-6">
        <TemplatesEditor templates={templates ?? []} canEdit={me.role !== "sales_executive"} />
      </div>
      {me.role === "admin" && services && <div className="mt-6"><ServicesEditor services={services} /></div>}
      {me.role === "admin" && org && <div className="mt-6"><OrgForm org={org} defaultTax={defaultTax} /></div>}
    </>
  );
}
