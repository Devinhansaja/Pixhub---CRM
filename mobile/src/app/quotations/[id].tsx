import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";
import { Sheet } from "@/components/Sheet";
import { AppText, Badge, Button, Card, Divider, ErrorBox, Input, KeyValue, Loading, Notice, Row, Screen } from "@/components/ui";
import { useData } from "@/hooks/useData";
import { useAuth } from "@/lib/auth";
import { quotationLabel, quotationTone } from "@/lib/constants";
import { formatDate, money } from "@/lib/format";
import { shareQuotationPdf, type QuotationForPdf } from "@/lib/quotation-pdf";
import { check, supabase } from "@/lib/supabase";
import { space, useTheme } from "@/theme";

type Q = QuotationForPdf & {
  id: string; status: string; created_by: string | null; review_note: string | null; contact_id: string;
  creator: { full_name: string } | null; approver: { full_name: string } | null; approved_at: string | null;
};

export default function QuotationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();
  const { profile, isManager } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState("");

  const { data, loading, error, reload } = useData(async () => {
    const [q, items, org] = await Promise.all([
      supabase.from("quotations").select("*, contact:contacts(company_name,contact_person,address,email,mobile), creator:profiles!quotations_created_by_fkey(full_name), approver:profiles!quotations_approved_by_fkey(full_name)").eq("id", id).maybeSingle(),
      supabase.from("quotation_items").select("description,quantity,unit_price,discount_pct,line_total").eq("quotation_id", id).order("sort_order"),
      supabase.from("organizations").select("name,address,phone,email,website").limit(1).maybeSingle(),
    ]);
    const row = check(q) as unknown as Q | null;
    if (!row) throw new Error("Quotation not found");
    return { ...row, items: (check(items) ?? []) as Q["items"], org: check(org) as Q["org"] } as Q;
  }, [id]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <Screen><ErrorBox message={error} onRetry={reload} /></Screen>;
  const q = data!;
  const mine = q.created_by === profile!.id;

  const setStatus = async (status: string, extra: Record<string, unknown> = {}, label = status) => {
    setBusy(label);
    const { error: e } = await supabase.from("quotations").update({ status, ...extra }).eq("id", q.id);
    setBusy(null);
    if (e) Alert.alert("Couldn't update", e.message); else reload();
  };

  return (
    <>
      <Stack.Screen options={{ title: q.number }} />
      <Screen>
        <Card style={{ gap: space.md }}>
          <Row style={{ alignItems: "flex-start" }}>
            <View style={{ flex: 1, gap: 4 }}>
              <AppText variant="heading">{q.contact?.company_name}</AppText>
              <AppText variant="caption" muted>{q.number} · issued {formatDate(q.issue_date)} · valid until {formatDate(q.expiry_date)}</AppText>
            </View>
            <Badge label={quotationLabel(q.status)} tone={quotationTone(q.status)} />
          </Row>
          <AppText variant="title" color={t.primary}>{money(q.total, q.currency)}</AppText>
          {q.review_note && q.status === "draft" && <Notice tone="warning" icon="chatbubble-ellipses-outline">Changes requested: {q.review_note}</Notice>}
          <KeyValue icon="person-outline" label="Prepared by" value={q.creator?.full_name} />
          <KeyValue icon="shield-checkmark-outline" label="Approved by" value={q.approver ? `${q.approver.full_name} · ${formatDate(q.approved_at, true)}` : null} />
          <KeyValue icon="business-outline" label="Lead" value={q.contact?.company_name} onPress={() => router.push(`/lead/${q.contact_id}`)} />
        </Card>

        <Card style={{ gap: space.sm }}>
          <AppText variant="subheading">Items</AppText>
          {q.items.map((i, n) => (
            <View key={n} style={{ gap: 2, paddingVertical: 6 }}>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <AppText style={{ flex: 1, fontWeight: "600" }}>{i.description}</AppText>
                <AppText style={{ fontWeight: "600" }}>{money(i.line_total, q.currency)}</AppText>
              </Row>
              <AppText variant="caption" muted>{i.quantity} × {money(i.unit_price, q.currency)}{i.discount_pct ? ` · ${i.discount_pct}% off` : ""}</AppText>
            </View>
          ))}
          <Divider />
          <Row style={{ justifyContent: "space-between" }}><AppText muted>Subtotal</AppText><AppText>{money(q.subtotal, q.currency)}</AppText></Row>
          {q.discount_amount > 0 && <Row style={{ justifyContent: "space-between" }}><AppText muted>Discount</AppText><AppText>- {money(q.discount_amount, q.currency)}</AppText></Row>}
          {q.tax_rate > 0 && <Row style={{ justifyContent: "space-between" }}><AppText muted>Tax ({q.tax_rate}%)</AppText><AppText>{money(q.tax_amount, q.currency)}</AppText></Row>}
          <Row style={{ justifyContent: "space-between" }}><AppText variant="subheading">Total</AppText><AppText variant="subheading">{money(q.total, q.currency)}</AppText></Row>
          {q.notes && <><Divider /><AppText variant="caption" muted>{q.notes}</AppText></>}
        </Card>

        <Card style={{ gap: space.md }}>
          <AppText variant="subheading">Actions</AppText>
          <Button title="Share PDF" icon="share-outline" variant="secondary" loading={busy === "pdf"} onPress={async () => {
            setBusy("pdf");
            try { await shareQuotationPdf(q); } catch (e) { Alert.alert("Couldn't create the PDF", e instanceof Error ? e.message : ""); }
            setBusy(null);
          }} />
          {q.status === "draft" && <Button title="Submit for approval" icon="send-outline" loading={busy === "submit"} onPress={() => setStatus("pending_approval", {}, "submit")} />}
          {q.status === "draft" && isManager && <Button title="Approve directly" icon="checkmark-done-outline" variant="success" loading={busy === "approve"} onPress={() => setStatus("approved", { review_note: null }, "approve")} />}
          {q.status === "pending_approval" && isManager && !mine && (
            <>
              <Button title="Approve" icon="checkmark-circle-outline" variant="success" loading={busy === "approve"} onPress={() => setStatus("approved", { review_note: null }, "approve")} />
              <Button title="Request changes" icon="arrow-undo-outline" variant="secondary" onPress={() => setReviewOpen(true)} />
            </>
          )}
          {q.status === "pending_approval" && mine && <Button title="Withdraw to draft" variant="secondary" loading={busy === "withdraw"} onPress={() => setStatus("draft", {}, "withdraw")} />}
          {q.status === "approved" && <Button title="Mark as sent to customer" icon="paper-plane-outline" loading={busy === "sent"} onPress={() => setStatus("sent", {}, "sent")} />}
          {(q.status === "sent" || q.status === "expired") && (
            <Row gap={space.sm}>
              <Button title="Accepted 🎉" variant="success" style={{ flex: 1 }} loading={busy === "acc"} onPress={() => setStatus("accepted", {}, "acc")} />
              <Button title="Rejected" variant="danger" style={{ flex: 1 }} loading={busy === "rej"} onPress={() => setStatus("rejected", {}, "rej")} />
            </Row>
          )}
          {q.status === "draft" && <AppText variant="caption" muted>To change items or prices, edit the draft in the web CRM.</AppText>}
        </Card>
      </Screen>

      <Sheet visible={reviewOpen} title="Request changes" onClose={() => setReviewOpen(false)}>
        <Input value={reviewNote} onChangeText={setReviewNote} multiline placeholder="What should be changed?" autoFocus />
        <Button title="Send back to draft" disabled={!reviewNote.trim()} loading={busy === "review"} onPress={async () => {
          await setStatus("draft", { review_note: reviewNote.trim().slice(0, 1000) }, "review");
          setReviewOpen(false); setReviewNote("");
        }} />
      </Sheet>
    </>
  );
}
