import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { AppText, Button, Card, ErrorBox, Input, Loading, Screen, SelectField } from "@/components/ui";
import { useResponsive } from "@/hooks/useResponsive";
import { useAuth } from "@/lib/auth";
import { SL_DISTRICTS } from "@/lib/constants";
import { normalizePhone, normalizeUrl } from "@/lib/format";
import { logActivity } from "@/lib/leads";
import { supabase } from "@/lib/supabase";
import { space } from "@/theme";

const FIELDS = ["company_name", "industry", "contact_person", "mobile", "landline", "email", "district", "city", "address", "website", "facebook_url", "notes", "estimated_value"] as const;
type Form = Record<(typeof FIELDS)[number], string>;
const empty = Object.fromEntries(FIELDS.map((f) => [f, ""])) as Form;

export default function LeadEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { profile } = useAuth();
  const { isTablet } = useResponsive();
  const [form, setForm] = useState<Form>(empty);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    supabase.from("contacts").select(FIELDS.join(",")).eq("id", id).maybeSingle().then(({ data, error: e }) => {
      if (e || !data) setError(e?.message ?? "Lead not found");
      else setForm(Object.fromEntries(FIELDS.map((f) => [f, (data as unknown as Record<string, unknown>)[f] == null ? "" : String((data as unknown as Record<string, unknown>)[f])])) as Form);
      setLoading(false);
    });
  }, [id]);

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setError(null);
    const company = form.company_name.trim();
    if (!company) return setError("Company name is required.");
    const mobile = form.mobile.trim() ? normalizePhone(form.mobile) : null;
    if (form.mobile.trim() && mobile?.kind !== "mobile") return setError("Mobile number is not a valid Sri Lankan mobile (07X XXX XXXX).");
    const landline = form.landline.trim() ? normalizePhone(form.landline) : null;
    if (form.landline.trim() && !landline) return setError("Landline number is not valid.");
    const email = form.email.trim().toLowerCase() || null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("Email is not valid.");
    const value = form.estimated_value.trim() ? Number(form.estimated_value.replace(/,/g, "")) : null;
    if (value !== null && (!Number.isFinite(value) || value < 0)) return setError("Estimated value must be a positive number.");

    const s = (v: string, max = 500) => v.trim().slice(0, max) || null;
    const payload = {
      company_name: company.slice(0, 300), industry: s(form.industry, 200), contact_person: s(form.contact_person, 200),
      mobile: mobile?.e164 ?? null, landline: landline?.e164 ?? null, email, district: s(form.district, 100), city: s(form.city, 100),
      address: s(form.address), website: normalizeUrl(form.website), facebook_url: normalizeUrl(form.facebook_url), notes: s(form.notes, 2000),
      estimated_value: value,
    };
    setSaving(true);
    try {
      if (id) {
        const { error: e } = await supabase.from("contacts").update(payload).eq("id", id);
        if (e) throw e;
        await supabase.rpc("classify_contacts", { p_ids: [id] });
        router.back();
      } else {
        const { data, error: e } = await supabase.from("contacts").insert({ ...payload, assigned_to: profile!.id, created_by: profile!.id }).select("id").single();
        if (e) throw e;
        await supabase.rpc("classify_contacts", { p_ids: [data.id] });
        await logActivity(data.id, profile!.id, "system", `Lead added from the mobile app by ${profile!.full_name}`);
        router.replace(`/lead/${data.id}`);
      }
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setError(err.code === "23505" ? "A lead with this mobile number (or same name and city) already exists." : err.message ?? "Couldn't save");
    } finally { setSaving(false); }
  };

  if (loading) return <Loading />;
  const half = isTablet ? { flexBasis: "48%" as const, flexGrow: 1 } : { width: "100%" as const };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: id ? "Edit lead" : "New lead", headerRight: () => <Button small title="Save" onPress={save} loading={saving} /> }} />
      <Screen>
        {error && <ErrorBox message={error} />}
        <Card style={{ gap: space.lg }}>
          <AppText variant="subheading">Company</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
            <View style={half}><Input label="Company name *" value={form.company_name} onChangeText={set("company_name")} /></View>
            <View style={half}><Input label="Industry" value={form.industry} onChangeText={set("industry")} placeholder="e.g. Restaurant" /></View>
            <View style={half}><SelectField label="District" value={form.district || null} onChange={set("district")} options={SL_DISTRICTS.map((d) => ({ value: d, label: d }))} /></View>
            <View style={half}><Input label="City" value={form.city} onChangeText={set("city")} /></View>
            <View style={{ width: "100%" }}><Input label="Address" value={form.address} onChangeText={set("address")} /></View>
          </View>
        </Card>
        <Card style={{ gap: space.lg }}>
          <AppText variant="subheading">Contact</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
            <View style={half}><Input label="Contact person" value={form.contact_person} onChangeText={set("contact_person")} /></View>
            <View style={half}><Input label="Mobile" value={form.mobile} onChangeText={set("mobile")} keyboardType="phone-pad" placeholder="077 123 4567" /></View>
            <View style={half}><Input label="Landline" value={form.landline} onChangeText={set("landline")} keyboardType="phone-pad" /></View>
            <View style={half}><Input label="Email" value={form.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" /></View>
            <View style={half}><Input label="Website" value={form.website} onChangeText={set("website")} autoCapitalize="none" keyboardType="url" /></View>
            <View style={half}><Input label="Facebook page" value={form.facebook_url} onChangeText={set("facebook_url")} autoCapitalize="none" keyboardType="url" /></View>
          </View>
        </Card>
        <Card style={{ gap: space.lg }}>
          <AppText variant="subheading">Sales</AppText>
          <Input label="Estimated value (LKR)" value={form.estimated_value} onChangeText={set("estimated_value")} keyboardType="numeric" />
          <Input label="Notes" value={form.notes} onChangeText={set("notes")} multiline />
        </Card>
        <Button title={id ? "Save changes" : "Add lead"} onPress={save} loading={saving} full />
        {!id && <AppText variant="caption" muted style={{ textAlign: "center" }}>New leads are assigned to you and classified automatically.</AppText>}
      </Screen>
    </KeyboardAvoidingView>
  );
}
