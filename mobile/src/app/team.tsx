import { Linking, View } from "react-native";
import { AppText, Avatar, Badge, Card, ErrorBox, Loading, Notice, Row, Screen } from "@/components/ui";
import { useData } from "@/hooks/useData";
import { ROLES, WEB_URL } from "@/lib/constants";
import { compact, money } from "@/lib/format";
import { check, supabase } from "@/lib/supabase";
import { space } from "@/theme";

interface P { id: string; full_name: string; email: string; phone: string | null; role: string; is_active: boolean }
interface Owner { name: string; leads: number; contacted: number; won: number; revenue: number }

export default function Team() {
  const { data, loading, error, refresh, refreshing, reload } = useData(async () => {
    const [p, b] = await Promise.all([
      supabase.from("profiles").select("id,full_name,email,phone,role,is_active").order("full_name"),
      supabase.rpc("dashboard_breakdowns"),
    ]);
    const owners = ((check(b) as { by_owner: Owner[] }).by_owner ?? []);
    return { people: (check(p) ?? []) as P[], owners: new Map(owners.map((o) => [o.name, o])) };
  });
  if (loading && !data) return <Loading />;
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {error && <ErrorBox message={error} onRetry={reload} />}
      <Notice icon="person-add-outline">To add team members or change roles, use Team Management in the web CRM.</Notice>
      {data?.people.map((p) => {
        const o = data.owners.get(p.full_name);
        return (
          <Card key={p.id} style={{ gap: space.sm, opacity: p.is_active ? 1 : 0.55 }} onPress={p.phone ? () => Linking.openURL(`tel:${p.phone}`) : undefined}>
            <Row gap={space.md}>
              <Avatar name={p.full_name} />
              <View style={{ flex: 1 }}>
                <AppText style={{ fontWeight: "700" }}>{p.full_name}</AppText>
                <AppText variant="caption" muted>{p.email}{p.phone ? ` · ${p.phone}` : ""}</AppText>
              </View>
              <Badge label={p.is_active ? ROLES[p.role] ?? p.role : "Inactive"} tone={p.role === "admin" ? "violet" : p.role === "sales_manager" ? "primary" : "neutral"} />
            </Row>
            {o && (
              <Row wrap gap={14}>
                <AppText variant="caption">{compact(o.leads)} leads</AppText>
                <AppText variant="caption">{compact(o.contacted)} contacted</AppText>
                <AppText variant="caption">{o.won} won</AppText>
                <AppText variant="caption">{money(o.revenue)}</AppText>
              </Row>
            )}
          </Card>
        );
      })}
      <AppText variant="caption" faint style={{ textAlign: "center" }} >{WEB_URL.replace(/^https?:\/\//, "")}/team</AppText>
    </Screen>
  );
}
