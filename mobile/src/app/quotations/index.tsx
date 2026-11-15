import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { AppText, Badge, Card, Chips, EmptyState, ErrorBox, Loading, Row, Screen } from "@/components/ui";
import { useData } from "@/hooks/useData";
import { QUOTATION_STATUSES, quotationLabel, quotationTone } from "@/lib/constants";
import { formatDate, money } from "@/lib/format";
import { check, supabase } from "@/lib/supabase";
import { space } from "@/theme";

interface Q { id: string; number: string; status: string; total: number; currency: string; issue_date: string; expiry_date: string; contact: { company_name: string } | null; creator: { full_name: string } | null }

export default function Quotations() {
  const router = useRouter();
  const [status, setStatus] = useState("open");
  const { data, loading, error, refresh, refreshing, reload } = useData(async () => {
    supabase.rpc("expire_quotations").then(() => {}, () => {});
    let q = supabase.from("quotations").select("id,number,status,total,currency,issue_date,expiry_date,contact:contacts(company_name),creator:profiles!quotations_created_by_fkey(full_name)");
    if (status === "open") q = q.in("status", ["draft", "pending_approval", "approved", "sent"]);
    else if (status !== "all") q = q.eq("status", status);
    return (check(await q.order("created_at", { ascending: false }).limit(100)) ?? []) as unknown as Q[];
  }, [status]);

  if (loading && !data) return <Loading />;
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Chips value={status} onChange={setStatus} options={[{ value: "open", label: "Open" }, { value: "all", label: "All" }, ...QUOTATION_STATUSES.map((s) => ({ value: s.value, label: s.label }))]} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {(data ?? []).length === 0 ? <EmptyState icon="document-text-outline" title="No quotations" message="Create one from a lead's page (Quotation button)." /> :
        data!.map((q) => (
          <Card key={q.id} onPress={() => router.push(`/quotations/${q.id}`)} style={{ gap: space.sm }}>
            <Row>
              <View style={{ flex: 1 }}>
                <AppText variant="subheading" numberOfLines={1}>{q.contact?.company_name ?? "—"}</AppText>
                <AppText variant="caption" muted>{q.number} · {formatDate(q.issue_date)} · by {q.creator?.full_name ?? "—"}</AppText>
              </View>
              <AppText variant="subheading">{money(q.total, q.currency)}</AppText>
            </Row>
            <Badge label={quotationLabel(q.status)} tone={quotationTone(q.status)} />
          </Card>
        ))}
    </Screen>
  );
}
