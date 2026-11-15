import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from "react-native";
import { LEAD_SUMMARY_COLUMNS, LeadCard, type LeadSummary } from "@/components/LeadCard";
import { AppText, Chips, EmptyState, ErrorBox, PickerSheet, Row, SearchBar } from "@/components/ui";
import { useResponsive } from "@/hooks/useResponsive";
import { useAuth } from "@/lib/auth";
import { SL_DISTRICTS, STAGES } from "@/lib/constants";
import { supabase } from "@/lib/supabase";
import { radius, space, useTheme } from "@/theme";

const PAGE = 30;
type Has = "all" | "mobile" | "email" | "website" | "no_website";
type Sort = "score" | "newest" | "name";

export default function Leads() {
  const t = useTheme();
  const router = useRouter();
  const { profile, isManager } = useAuth();
  const { isTablet, isLarge, contentWidth, gutter } = useResponsive();
  const cols = isLarge ? 3 : isTablet ? 2 : 1;

  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [stage, setStage] = useState("all");
  const [mine, setMine] = useState(false);
  const [has, setHas] = useState<Has>("all");
  const [district, setDistrict] = useState<string>("all");
  const [sort, setSort] = useState<Sort>("score");
  const [sheet, setSheet] = useState<null | "district" | "has" | "sort">(null);

  const [rows, setRows] = useState<LeadSummary[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => { const h = setTimeout(() => setDebounced(q.trim()), 350); return () => clearTimeout(h); }, [q]);

  const fetchPage = useCallback(async (from: number) => {
    let query = supabase.from("contacts").select(LEAD_SUMMARY_COLUMNS, { count: from === 0 ? "exact" : undefined });
    if (debounced) {
      const s = debounced.replace(/[,()%*\\]/g, " ").trim();
      const digits = s.replace(/\D/g, "");
      const parts = [`company_name.ilike.%${s}%`, `contact_person.ilike.%${s}%`, `email.ilike.%${s}%`];
      if (digits.length >= 4) parts.push(`mobile.ilike.%${digits.replace(/^0/, "")}%`);
      query = query.or(parts.join(","));
    }
    if (stage !== "all") query = query.eq("stage", stage);
    if (mine) query = query.eq("assigned_to", profile!.id);
    if (district !== "all") query = query.eq("district", district);
    if (has === "mobile") query = query.not("mobile", "is", null);
    if (has === "email") query = query.not("email", "is", null);
    if (has === "website") query = query.not("website", "is", null);
    if (has === "no_website") query = query.is("website", null);
    query = sort === "score" ? query.order("lead_score", { ascending: false }).order("created_at", { ascending: false })
      : sort === "newest" ? query.order("created_at", { ascending: false }) : query.order("company_name");
    return query.range(from, from + PAGE - 1);
  }, [debounced, stage, mine, district, has, sort, profile]);

  const load = useCallback(async (mode: "load" | "refresh") => {
    const id = ++seq.current;
    if (mode === "load") setLoading(true); else setRefreshing(true);
    const { data, count, error: e } = await fetchPage(0);
    if (id !== seq.current) return;
    if (e) setError(e.message); else { setError(null); setRows((data ?? []) as unknown as LeadSummary[]); setTotal(count ?? null); }
    setLoading(false); setRefreshing(false);
  }, [fetchPage]);

  useEffect(() => { load("load"); }, [load]);

  const loadMore = async () => {
    if (more || loading || (total !== null && rows.length >= total)) return;
    setMore(true);
    const id = seq.current;
    const { data } = await fetchPage(rows.length);
    if (id === seq.current && data) setRows((r) => [...r, ...(data as unknown as LeadSummary[])]);
    setMore(false);
  };

  const hasLabel: Record<Has, string> = { all: "Any contact info", mobile: "Has mobile", email: "Has email", website: "Has website", no_website: "No website" };
  const sortLabel: Record<Sort, string> = { score: "Best score", newest: "Newest", name: "Name A–Z" };
  const filterPill = (label: string, active: boolean, onPress: () => void) => (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: active ? t.primary : t.border, backgroundColor: active ? t.primarySoft : t.card }}>
      <AppText variant="caption" color={active ? t.primary : t.text} style={{ fontWeight: "600" }}>{label}</AppText>
      <Ionicons name="chevron-down" size={12} color={active ? t.primary : t.textMuted} />
    </Pressable>
  );

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <SearchBar value={q} onChangeText={setQ} placeholder="Search company, person, phone, email" />
      <Chips value={stage} onChange={setStage} options={[{ value: "all", label: "All stages" }, ...STAGES.map((s) => ({ value: s.value, label: s.label }))]} />
      <Row wrap gap={8}>
        {isManager && filterPill(mine ? "Only mine" : "Everyone", mine, () => setMine(!mine))}
        {filterPill(district === "all" ? "All districts" : district, district !== "all", () => setSheet("district"))}
        {filterPill(hasLabel[has], has !== "all", () => setSheet("has"))}
        {filterPill(sortLabel[sort], sort !== "score", () => setSheet("sort"))}
      </Row>
      <AppText variant="caption" muted>{total === null ? " " : `${total.toLocaleString("en-US")} lead${total === 1 ? "" : "s"}`}</AppText>
      {error && <ErrorBox message={error} onRetry={() => load("load")} />}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        key={cols}
        data={rows}
        numColumns={cols}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={header}
        contentContainerStyle={{ padding: gutter, paddingBottom: 96, width: "100%", maxWidth: contentWidth + 200, alignSelf: "center" }}
        columnWrapperStyle={cols > 1 ? { gap: space.md } : undefined}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        renderItem={({ item }) => <View style={{ flex: 1 / cols }}><LeadCard lead={item} onPress={() => router.push(`/lead/${item.id}`)} /></View>}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={t.primary} />}
        ListEmptyComponent={loading ? <ActivityIndicator color={t.primary} style={{ marginTop: 40 }} /> :
          <EmptyState icon="search" title="No leads found" message="Try a different search or clear the filters." />}
        ListFooterComponent={more ? <ActivityIndicator color={t.primary} style={{ margin: 16 }} /> : undefined}
        keyboardShouldPersistTaps="handled"
      />
      <Pressable accessibilityLabel="Add lead" onPress={() => router.push("/lead/edit")}
        style={({ pressed }) => ({ position: "absolute", right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: t.primary, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1, elevation: 4, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } })}>
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
      <PickerSheet visible={sheet === "district"} title="District" value={district} onClose={() => setSheet(null)} onSelect={setDistrict}
        options={[{ value: "all", label: "All districts" }, ...SL_DISTRICTS.map((d) => ({ value: d, label: d }))]} />
      <PickerSheet visible={sheet === "has"} title="Contact info" value={has} onClose={() => setSheet(null)} onSelect={setHas}
        options={(Object.keys(hasLabel) as Has[]).map((k) => ({ value: k, label: hasLabel[k] }))} />
      <PickerSheet visible={sheet === "sort"} title="Sort by" value={sort} onClose={() => setSheet(null)} onSelect={setSort}
        options={(Object.keys(sortLabel) as Sort[]).map((k) => ({ value: k, label: sortLabel[k] }))} />
    </View>
  );
}
