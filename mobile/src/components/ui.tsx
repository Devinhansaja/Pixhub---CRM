import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useResponsive } from "@/hooks/useResponsive";
import { font, radius, space, toneColors, useTheme, type Tone } from "@/theme";
import { initials } from "@/lib/format";

export type IconName = ComponentProps<typeof Ionicons>["name"];

// ---------------------------------------------------------------- Typography
type TextVariant = "title" | "heading" | "subheading" | "body" | "label" | "caption";
const textStyles: Record<TextVariant, TextStyle> = {
  title: { fontSize: font.xxl, fontWeight: "700", letterSpacing: -0.4 },
  heading: { fontSize: font.xl, fontWeight: "700", letterSpacing: -0.2 },
  subheading: { fontSize: font.lg, fontWeight: "600" },
  body: { fontSize: font.md },
  label: { fontSize: font.sm, fontWeight: "600" },
  caption: { fontSize: font.xs + 1 },
};

export function AppText({ variant = "body", muted, faint, color, style, numberOfLines, children, selectable }: {
  variant?: TextVariant; muted?: boolean; faint?: boolean; color?: string; style?: StyleProp<TextStyle>;
  numberOfLines?: number; children: ReactNode; selectable?: boolean;
}) {
  const t = useTheme();
  const c = color ?? (faint ? t.textFaint : muted ? t.textMuted : t.text);
  return <Text selectable={selectable} numberOfLines={numberOfLines} style={[textStyles[variant], { color: c }, style]}>{children}</Text>;
}

// ---------------------------------------------------------------- Layout
/** Scrollable screen with pull-to-refresh, responsive max width and safe-area padding. */
export function Screen({ children, refreshing, onRefresh, scroll = true, padded = true, style }: {
  children: ReactNode; refreshing?: boolean; onRefresh?: () => void; scroll?: boolean; padded?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const { contentWidth, gutter } = useResponsive();
  const inner = [{ width: "100%" as const, maxWidth: contentWidth, alignSelf: "center" as const, padding: padded ? gutter : 0, gap: space.lg }, style];
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: t.bg }]}><View style={[inner, { flex: 1 }]}>{children}</View></View>;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingBottom: space.xxl * 2 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.primary} /> : undefined}
    >
      <View style={inner}>{children}</View>
    </ScrollView>
  );
}

export function Row({ children, gap = space.sm, style, wrap }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; wrap?: boolean }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap, flexWrap: wrap ? "wrap" : "nowrap" }, style]}>{children}</View>;
}

export function Card({ children, style, onPress, onLongPress, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; onLongPress?: () => void; padded?: boolean }) {
  const t = useTheme();
  const base: ViewStyle = {
    backgroundColor: t.card, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border,
    padding: padded ? space.lg : 0, ...(t.dark ? {} : shadow),
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress ? () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); onLongPress(); } : undefined}
      style={({ pressed }) => [base, style, pressed && { opacity: 0.85, transform: [{ scale: 0.995 }] }]}>
      {children}
    </Pressable>
  );
}

const shadow: ViewStyle = Platform.select({
  ios: { shadowColor: "#0f172a", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  android: { elevation: 1.5 },
  default: {},
}) as ViewStyle;

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const t = useTheme();
  return (
    <Row style={{ justifyContent: "space-between", marginTop: space.sm }}>
      <AppText variant="subheading">{title}</AppText>
      {action && onAction && <Pressable hitSlop={10} onPress={onAction}><AppText variant="label" color={t.primary}>{action}</AppText></Pressable>}
    </Row>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />;
}

/** Lays children out in N equal columns (responsive grids for stat cards etc.). */
export function Grid({ children, columns, gap = space.md }: { children: ReactNode[]; columns: number; gap?: number }) {
  const items = children.filter(Boolean);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -gap / 2 }}>
      {items.map((c, i) => <View key={i} style={{ width: `${100 / columns}%`, paddingHorizontal: gap / 2, marginBottom: gap }}>{c}</View>)}
    </View>
  );
}

// ---------------------------------------------------------------- Controls
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";

export function Button({ title, onPress, variant = "primary", icon, loading, disabled, small, style, full }: {
  title: string; onPress?: () => void; variant?: ButtonVariant; icon?: IconName; loading?: boolean; disabled?: boolean;
  small?: boolean; style?: StyleProp<ViewStyle>; full?: boolean;
}) {
  const t = useTheme();
  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: t.primary, fg: t.onPrimary, border: t.primary },
    secondary: { bg: t.card, fg: t.text, border: t.border },
    ghost: { bg: "transparent", fg: t.primary, border: "transparent" },
    danger: { bg: t.dangerSoft, fg: t.danger, border: t.dangerSoft },
    success: { bg: t.success, fg: "#fff", border: t.success },
  };
  const p = palette[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={off}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress?.(); }}
      style={({ pressed }) => [{
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm,
        backgroundColor: p.bg, borderColor: p.border, borderWidth: 1, borderRadius: radius.md,
        paddingVertical: small ? 8 : 13, paddingHorizontal: small ? 12 : 18, opacity: off ? 0.55 : pressed ? 0.85 : 1,
        alignSelf: full ? "stretch" : "auto",
      }, style]}
    >
      {loading ? <ActivityIndicator size="small" color={p.fg} /> : icon ? <Ionicons name={icon} size={small ? 16 : 18} color={p.fg} /> : null}
      <Text style={{ color: p.fg, fontWeight: "600", fontSize: small ? font.sm : font.md }}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, color, size = 22, label, bg }: { icon: IconName; onPress: () => void; color?: string; size?: number; label: string; bg?: string }) {
  const t = useTheme();
  return (
    <Pressable accessibilityLabel={label} hitSlop={8} onPress={onPress}
      style={({ pressed }) => ({ padding: 8, borderRadius: radius.pill, backgroundColor: bg, opacity: pressed ? 0.6 : 1 })}>
      <Ionicons name={icon} size={size} color={color ?? t.text} />
    </Pressable>
  );
}

export function Input({ label, hint, error, icon, style, multiline, ...rest }: TextInputProps & { label?: string; hint?: string; error?: string | null; icon?: IconName }) {
    const t = useTheme();
    const [focus, setFocus] = useState(false);
    return (
      <View style={{ gap: 6 }}>
        {label && <AppText variant="label" muted>{label}</AppText>}
        <View style={{
          flexDirection: "row", alignItems: multiline ? "flex-start" : "center", gap: space.sm,
          backgroundColor: t.card, borderWidth: 1, borderColor: error ? t.danger : focus ? t.primary : t.border,
          borderRadius: radius.md, paddingHorizontal: space.md,
        }}>
          {icon && <Ionicons name={icon} size={18} color={t.textFaint} style={multiline ? { marginTop: 13 } : undefined} />}
          <TextInput
            placeholderTextColor={t.textFaint}
            multiline={multiline}
            onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
            onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
            style={[{ flex: 1, color: t.text, fontSize: font.md, paddingVertical: 12, minHeight: multiline ? 96 : undefined, textAlignVertical: multiline ? "top" : "center" }, style]}
            {...rest}
          />
        </View>
        {error ? <AppText variant="caption" color={t.danger}>{error}</AppText> : hint ? <AppText variant="caption" faint>{hint}</AppText> : null}
      </View>
    );
}

export function SearchBar({ value, onChangeText, placeholder = "Search…" }: { value: string; onChangeText: (s: string) => void; placeholder?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: t.card, borderRadius: radius.md, borderWidth: 1, borderColor: t.border, paddingHorizontal: 12 }}>
      <Ionicons name="search" size={18} color={t.textFaint} />
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={t.textFaint}
        returnKeyType="search" autoCorrect={false} style={{ flex: 1, color: t.text, fontSize: font.md, paddingVertical: 11 }} />
      {!!value && <IconButton icon="close-circle" size={18} color={t.textFaint} label="Clear search" onPress={() => onChangeText("")} />}
    </View>
  );
}

/** Horizontal scrolling filter chips. */
export function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => { Haptics.selectionAsync().catch(() => {}); onChange(o.value); }}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1,
              backgroundColor: active ? t.primary : t.card, borderColor: active ? t.primary : t.border }}>
            <Text style={{ color: active ? t.onPrimary : t.text, fontWeight: "600", fontSize: font.sm }}>
              {o.label}{o.count !== undefined ? ` · ${o.count}` : ""}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Badge({ label, tone = "neutral", icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const t = useTheme();
  const [bg, fg] = toneColors(t, tone);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3, alignSelf: "flex-start" }}>
      {icon && <Ionicons name={icon} size={12} color={fg} />}
      <Text style={{ color: fg, fontSize: font.xs, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

export function Avatar({ name, size = 40, tone = "primary" }: { name: string | null | undefined; size?: number; tone?: Tone }) {
  const t = useTheme();
  const [bg, fg] = toneColors(t, tone);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: fg, fontWeight: "700", fontSize: size * 0.38 }}>{initials(name)}</Text>
    </View>
  );
}

export function StatCard({ label, value, icon, tone = "primary", hint, onPress }: { label: string; value: string | number; icon: IconName; tone?: Tone; hint?: string; onPress?: () => void }) {
  const t = useTheme();
  const [bg, fg] = toneColors(t, tone);
  return (
    <Card onPress={onPress} style={{ gap: space.sm, minHeight: 112 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={18} color={fg} />
      </View>
      <AppText variant="heading" numberOfLines={1}>{value}</AppText>
      <AppText variant="caption" muted numberOfLines={1}>{label}</AppText>
      {hint && <AppText variant="caption" faint numberOfLines={1}>{hint}</AppText>}
    </Card>
  );
}

/** Simple horizontal bar list (used instead of a chart library — works everywhere). */
export function BarList({ items, format = (n: number) => n.toLocaleString("en-US") }: { items: { name: string; value: number }[]; format?: (n: number) => string }) {
  const t = useTheme();
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <AppText muted>No data yet</AppText>;
  return (
    <View style={{ gap: 10 }}>
      {items.map((i) => (
        <View key={i.name} style={{ gap: 4 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <AppText variant="label" numberOfLines={1} style={{ flex: 1 }}>{i.name}</AppText>
            <AppText variant="label" muted>{format(i.value)}</AppText>
          </Row>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.cardAlt, overflow: "hidden" }}>
            <View style={{ width: `${(i.value / max) * 100}%`, height: 8, borderRadius: 4, backgroundColor: t.primary }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ListItem({ title, subtitle, right, left, onPress, icon, chevron = !!onPress, danger }: {
  title: string; subtitle?: string | null; right?: ReactNode; left?: ReactNode; onPress?: () => void; icon?: IconName; chevron?: boolean; danger?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}>
      {left ?? (icon ? (
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: danger ? t.dangerSoft : t.primarySoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={icon} size={18} color={danger ? t.danger : t.primary} />
        </View>
      ) : null)}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body" color={danger ? t.danger : undefined} style={{ fontWeight: "600" }} numberOfLines={1}>{title}</AppText>
        {!!subtitle && <AppText variant="caption" muted numberOfLines={2}>{subtitle}</AppText>}
      </View>
      {right}
      {chevron && <Ionicons name="chevron-forward" size={18} color={t.textFaint} />}
    </Pressable>
  );
}

// ---------------------------------------------------------------- States
export function Loading({ label = "Loading…" }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xxl, gap: space.md, backgroundColor: t.bg }}>
      <ActivityIndicator color={t.primary} size="large" />
      <AppText muted>{label}</AppText>
    </View>
  );
}

export function EmptyState({ icon = "file-tray-outline", title, message, action }: { icon?: IconName; title: string; message?: string; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: "center", padding: space.xxl, gap: space.sm }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: t.primarySoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={28} color={t.primary} />
      </View>
      <AppText variant="subheading" style={{ textAlign: "center" }}>{title}</AppText>
      {message && <AppText muted style={{ textAlign: "center" }}>{message}</AppText>}
      {action}
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme();
  return (
    <Card style={{ backgroundColor: t.dangerSoft, borderColor: t.dangerSoft, gap: space.sm }}>
      <Row><Ionicons name="alert-circle" size={18} color={t.danger} /><AppText color={t.danger} style={{ flex: 1 }}>{message}</AppText></Row>
      {onRetry && <Button title="Try again" variant="secondary" small onPress={onRetry} />}
    </Card>
  );
}

export function Notice({ tone = "primary", icon = "information-circle", children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  const t = useTheme();
  const [bg, fg] = toneColors(t, tone);
  return (
    <View style={{ flexDirection: "row", gap: 8, backgroundColor: bg, borderRadius: radius.md, padding: space.md }}>
      <Ionicons name={icon} size={18} color={fg} />
      <Text style={{ color: fg, flex: 1, fontSize: font.sm, lineHeight: 19 }}>{children}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- Pickers
/** Bottom-sheet style option picker. */
export function PickerSheet<T extends string>({ visible, title, options, value, onSelect, onClose }: {
  visible: boolean; title: string; options: { value: T; label: string; subtitle?: string }[]; value?: T | null; onSelect: (v: T) => void; onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { contentWidth } = useResponsive();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: t.overlay }} onPress={onClose} />
      <View style={{ backgroundColor: t.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "75%",
        paddingBottom: insets.bottom + space.md, width: "100%", maxWidth: contentWidth, alignSelf: "center" }}>
        <View style={{ alignItems: "center", paddingTop: 10 }}><View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: t.border }} /></View>
        <Row style={{ justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: space.md }}>
          <AppText variant="subheading">{title}</AppText>
          <IconButton icon="close" label="Close" onPress={onClose} />
        </Row>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg }}>
          {options.map((o) => (
            <Pressable key={o.value} onPress={() => { onSelect(o.value); onClose(); }}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border, opacity: pressed ? 0.6 : 1 })}>
              <View style={{ flex: 1 }}>
                <AppText style={{ fontWeight: o.value === value ? "700" : "400" }}>{o.label}</AppText>
                {o.subtitle && <AppText variant="caption" muted>{o.subtitle}</AppText>}
              </View>
              {o.value === value && <Ionicons name="checkmark" size={20} color={t.primary} />}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** A form field that opens a PickerSheet. */
export function SelectField<T extends string>({ label, value, options, onChange, placeholder = "Choose…" }: {
  label: string; value: T | null; options: { value: T; label: string; subtitle?: string }[]; onChange: (v: T) => void; placeholder?: string;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label" muted>{label}</AppText>
      <Pressable onPress={() => setOpen(true)} style={{ flexDirection: "row", alignItems: "center", backgroundColor: t.card, borderWidth: 1, borderColor: t.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 13 }}>
        <AppText style={{ flex: 1 }} color={current ? t.text : t.textFaint}>{current?.label ?? placeholder}</AppText>
        <Ionicons name="chevron-down" size={18} color={t.textFaint} />
      </Pressable>
      <PickerSheet visible={open} title={label} options={options} value={value} onSelect={onChange} onClose={() => setOpen(false)} />
    </View>
  );
}

export function KeyValue({ label, value, onPress, icon }: { label: string; value: string | null | undefined; onPress?: () => void; icon?: IconName }) {
  const t = useTheme();
  if (!value) return null;
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={{ flexDirection: "row", gap: space.md, paddingVertical: 8 }}>
      {icon && <Ionicons name={icon} size={18} color={t.textMuted} style={{ marginTop: 1 }} />}
      <View style={{ flex: 1 }}>
        <AppText variant="caption" muted>{label}</AppText>
        <AppText color={onPress ? t.primary : t.text} selectable={!onPress}>{value}</AppText>
      </View>
    </Pressable>
  );
}

export { SafeAreaView };
