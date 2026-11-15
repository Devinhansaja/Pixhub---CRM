import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { stageLabel, stageTone } from "@/lib/constants";
import { formatPhone } from "@/lib/format";
import { space, useTheme } from "@/theme";
import { AppText, Badge, Card, Row } from "./ui";

export interface LeadSummary {
  id: string; company_name: string; industry: string | null; city: string | null; district: string | null;
  mobile: string | null; email: string | null; website: string | null; stage: string; lead_score: number;
  owner?: { full_name: string } | null;
}

export const LEAD_SUMMARY_COLUMNS = "id,company_name,industry,city,district,mobile,email,website,stage,lead_score,owner:profiles!contacts_assigned_to_fkey(full_name)";

function scoreTone(s: number) { return s >= 70 ? "success" : s >= 45 ? "warning" : "neutral"; }

export function LeadCard({ lead, onPress, onLongPress, compact }: { lead: LeadSummary; onPress: () => void; onLongPress?: () => void; compact?: boolean }) {
  const t = useTheme();
  const place = [lead.city, lead.district].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
  return (
    <Card onPress={onPress} onLongPress={onLongPress} style={{ gap: space.sm, padding: compact ? space.md : space.lg }}>
      <Row style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="subheading" numberOfLines={1}>{lead.company_name}</AppText>
          <AppText variant="caption" muted numberOfLines={1}>{[lead.industry, place].filter(Boolean).join(" · ") || "No details yet"}</AppText>
        </View>
        <Badge label={`${lead.lead_score}`} tone={scoreTone(lead.lead_score)} icon="star" />
      </Row>
      <Row wrap gap={6}>
        <Badge label={stageLabel(lead.stage)} tone={stageTone(lead.stage)} />
        {lead.mobile && <Row gap={3}><Ionicons name="call-outline" size={12} color={t.textMuted} /><AppText variant="caption" muted>{formatPhone(lead.mobile)}</AppText></Row>}
        {lead.email && <Ionicons name="mail-outline" size={13} color={t.textMuted} />}
        {lead.website && <Ionicons name="globe-outline" size={13} color={t.textMuted} />}
        {lead.owner?.full_name && !compact && <AppText variant="caption" faint>· {lead.owner.full_name}</AppText>}
      </Row>
    </Card>
  );
}
