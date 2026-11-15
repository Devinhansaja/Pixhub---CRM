import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { AppText, Button, Card, Divider, ErrorBox, IconButton, Input, Loading, PickerSheet, Row, Screen } from "@/components/ui";
import { money } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { space, useTheme } from "@/theme";

interface Service { id: string; name: string; base_price: number | null; description: string | null }
interface Item { key: string; service_id: string | null; description: string; quantity: string; unit_price: string; discount_pct: string }

let k = 0;
const newItem = (s?: Service): Item => ({ key: String(++k), service_id: s?.id ?? null, description: s?.name ?? "", quantity: "1", unit_price: s?.base_price ? String(s.base_price) : "", discount_pct: "" });
const num = (s: string) => Number(s.replace(/,/g, "")) || 0;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function NewQuotation() {
  const { contact, name } = useLocalSearchParams<{ contact: string; name?: string }>();
  const router = useRouter();
  const t = useTheme();
  const [services, setServices] = useState<Service[] | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [discount, setDiscount] = useState("");
  const [tax, setTax] = useState("0");
  const [days, setDays] = useState("30");
  const [notes, setNotes] = useState("");
  const [pick, setPick] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from("services").select("id,name,base_price,description").eq("is_active", true).order("sort_order"),
      supabase.from("lead_service_recommendations").select("service_id,confidence").eq("contact_id", contact).order("confidence", { ascending: false }).limit(1),
      supabase.from("system_settings").select("key,value").in("key", ["quotation", "company"]),
    ]).then(([s, rec, settings]) => {
      const list = (s.data ?? []) as Service[];
      setServices(list);
      const best = list.find((x) => x.id === rec.data?.[0]?.service_id);
      setItems([newItem(best)]);
      const cfg = Object.fromEntries((settings.data ?? []).map((r) => [r.key, r.value as Record<string, unknown>]));
      if (typeof cfg.quotation?.default_notes === "string") setNotes(cfg.quotation.default_notes);
      if (cfg.company?.default_tax_rate !== undefined) setTax(String(cfg.company.default_tax_rate));
    });
  }, [contact]);

  const totals = useMemo(() => {
    const sub = items.reduce((s, i) => s + num(i.quantity) * num(i.unit_price) * (1 - num(i.discount_pct) / 100), 0);
    const after = Math.max(0, sub - num(discount));
    const taxAmt = after * num(tax) / 100;
    return { sub, taxAmt, total: after + taxAmt };
  }, [items, discount, tax]);

  if (!services) return <Loading />;
  const upd = (key: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const save = async () => {
    setError(null);
    const clean = items.filter((i) => i.description.trim());
    if (!clean.length) return setError("Add at least one item.");
    if (clean.some((i) => num(i.quantity) <= 0 || num(i.unit_price) < 0)) return setError("Each item needs a quantity above 0 and a price.");
    if (num(discount) > totals.sub) return setError("Discount can't be more than the subtotal.");
    const issue = new Date();
    const expiry = new Date(Date.now() + Math.max(1, Math.min(365, num(days) || 30)) * 86_400_000);
    setSaving(true);
    const { data, error: e } = await supabase.rpc("save_quotation", {
      p_id: null, p_contact: contact, p_deal: null, p_issue: iso(issue), p_expiry: iso(expiry),
      p_discount: num(discount), p_tax: num(tax), p_notes: notes.trim(),
      p_items: clean.map((i) => ({ service_id: i.service_id ?? "", description: i.description.trim(), quantity: num(i.quantity), unit_price: num(i.unit_price), discount_pct: num(i.discount_pct) })),
    });
    setSaving(false);
    if (e) setError(e.message); else router.replace(`/quotations/${data}`);
  };

  return (
    <Screen>
      {name && <AppText muted>For: <AppText style={{ fontWeight: "700" }}>{name}</AppText></AppText>}
      {error && <ErrorBox message={error} />}
      {items.map((i, idx) => (
        <Card key={i.key} style={{ gap: space.md }}>
          <Row style={{ justifyContent: "space-between" }}>
            <AppText variant="label" muted>Item {idx + 1}</AppText>
            {items.length > 1 && <IconButton icon="trash-outline" color={t.danger} label="Remove item" onPress={() => setItems(items.filter((x) => x.key !== i.key))} />}
          </Row>
          <Input label="Description" value={i.description} onChangeText={(v) => upd(i.key, { description: v })} />
          <Row gap={space.sm}>
            <View style={{ flex: 1 }}><Input label="Qty" value={i.quantity} onChangeText={(v) => upd(i.key, { quantity: v })} keyboardType="decimal-pad" /></View>
            <View style={{ flex: 2 }}><Input label="Unit price (LKR)" value={i.unit_price} onChangeText={(v) => upd(i.key, { unit_price: v })} keyboardType="decimal-pad" /></View>
            <View style={{ flex: 1 }}><Input label="Disc %" value={i.discount_pct} onChangeText={(v) => upd(i.key, { discount_pct: v })} keyboardType="decimal-pad" /></View>
          </Row>
        </Card>
      ))}
      <Row gap={space.sm} wrap>
        <Button small icon="add" title="Add PIXhub service" variant="secondary" onPress={() => setPick(true)} />
        <Button small icon="create-outline" title="Add custom item" variant="secondary" onPress={() => setItems([...items, newItem()])} />
      </Row>

      <Card style={{ gap: space.md }}>
        <Row gap={space.sm}>
          <View style={{ flex: 1 }}><Input label="Discount (LKR)" value={discount} onChangeText={setDiscount} keyboardType="decimal-pad" /></View>
          <View style={{ flex: 1 }}><Input label="Tax %" value={tax} onChangeText={setTax} keyboardType="decimal-pad" /></View>
          <View style={{ flex: 1 }}><Input label="Valid (days)" value={days} onChangeText={setDays} keyboardType="number-pad" /></View>
        </Row>
        <Input label="Terms & notes" value={notes} onChangeText={setNotes} multiline />
        <Divider />
        <Row style={{ justifyContent: "space-between" }}><AppText muted>Subtotal</AppText><AppText>{money(totals.sub)}</AppText></Row>
        {num(tax) > 0 && <Row style={{ justifyContent: "space-between" }}><AppText muted>Tax</AppText><AppText>{money(totals.taxAmt)}</AppText></Row>}
        <Row style={{ justifyContent: "space-between" }}><AppText variant="subheading">Total</AppText><AppText variant="subheading" color={t.primary}>{money(totals.total)}</AppText></Row>
      </Card>
      <Button title="Save draft quotation" onPress={save} loading={saving} full />

      <PickerSheet visible={pick} title="PIXhub services" onClose={() => setPick(false)}
        options={services.map((s) => ({ value: s.id, label: s.name, subtitle: s.base_price ? `from ${money(s.base_price)}` : "Price on request" }))}
        onSelect={(id) => {
          const s = services.find((x) => x.id === id)!;
          setItems((list) => (list.length === 1 && !list[0].description.trim() ? [newItem(s)] : [...list, newItem(s)]));
        }} />
    </Screen>
  );
}
