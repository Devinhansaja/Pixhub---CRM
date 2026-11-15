import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Modal, Platform, Pressable, View } from "react-native";
import { formatDate } from "@/lib/format";
import { radius, space, useTheme } from "@/theme";
import { AppText, Button, Row } from "./ui";

/** Date + time picker that works natively on iOS (sheet) and Android (dialogs). */
export function DateTimeField({ label, value, onChange, quick = true }: { label: string; value: Date | null; onChange: (d: Date | null) => void; quick?: boolean }) {
  const t = useTheme();
  const [iosOpen, setIosOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(value ?? defaultDate());

  const open = () => {
    const start = value ?? defaultDate();
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: start, mode: "date", minimumDate: new Date(Date.now() - 86_400_000 * 365),
        onChange: (e, date) => {
          if (e.type !== "set" || !date) return;
          DateTimePickerAndroid.open({
            value: date, mode: "time", is24Hour: true,
            onChange: (e2, time) => { if (e2.type === "set" && time) onChange(time); },
          });
        },
      });
    } else {
      setDraft(start);
      setIosOpen(true);
    }
  };

  const presets: [string, () => Date][] = [
    ["Today 5 PM", () => at(0, 17)], ["Tomorrow 10 AM", () => at(1, 10)], ["In 3 days", () => at(3, 10)], ["Next week", () => at(7, 10)],
  ];

  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label" muted>{label}</AppText>
      <Pressable onPress={open} style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: t.card, borderWidth: 1, borderColor: t.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 13 }}>
        <Ionicons name="calendar-outline" size={18} color={t.textFaint} />
        <AppText style={{ flex: 1 }} color={value ? t.text : t.textFaint}>{value ? formatDate(value, true) : "Pick date & time"}</AppText>
        {value && <Pressable hitSlop={10} onPress={() => onChange(null)}><Ionicons name="close-circle" size={18} color={t.textFaint} /></Pressable>}
      </Pressable>
      {quick && (
        <Row wrap gap={6}>
          {presets.map(([l, f]) => (
            <Pressable key={l} onPress={() => onChange(f())} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: t.primarySoft }}>
              <AppText variant="caption" color={t.primary} style={{ fontWeight: "600" }}>{l}</AppText>
            </Pressable>
          ))}
        </Row>
      )}
      {Platform.OS === "ios" && (
        <Modal visible={iosOpen} transparent animationType="fade" onRequestClose={() => setIosOpen(false)}>
          <Pressable style={{ flex: 1, backgroundColor: t.overlay }} onPress={() => setIosOpen(false)} />
          <View style={{ backgroundColor: t.card, padding: space.lg, gap: space.md, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: space.xxl }}>
            <AppText variant="subheading">{label}</AppText>
            <DateTimePicker value={draft} mode="datetime" display="inline" onChange={(_, d) => d && setDraft(d)} themeVariant={t.dark ? "dark" : "light"} />
            <Row style={{ justifyContent: "flex-end" }}>
              <Button title="Cancel" variant="secondary" onPress={() => setIosOpen(false)} />
              <Button title="Done" onPress={() => { onChange(draft); setIosOpen(false); }} />
            </Row>
          </View>
        </Modal>
      )}
    </View>
  );
}

function at(days: number, hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}
function defaultDate() { return at(1, 10); }
