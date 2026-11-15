import Constants from "expo-constants";
import { useRouter, type Href } from "expo-router";
import { Alert, Linking, View } from "react-native";
import { AppText, Avatar, Card, Divider, ListItem, Row, Screen, type IconName } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { ROLES, WEB_URL } from "@/lib/constants";
import { space } from "@/theme";

export default function More() {
  const router = useRouter();
  const { profile, isManager, isAdmin, signOut } = useAuth();

  const section = (items: { icon: IconName; title: string; subtitle?: string; href?: Href; url?: string; show?: boolean }[]) => (
    <Card padded={false} style={{ paddingHorizontal: space.lg }}>
      {items.filter((i) => i.show !== false).map((i, idx) => (
        <View key={i.title}>
          {idx > 0 && <Divider />}
          <ListItem icon={i.icon} title={i.title} subtitle={i.subtitle}
            onPress={() => (i.href ? router.push(i.href) : i.url && Linking.openURL(i.url))} />
        </View>
      ))}
    </Card>
  );

  return (
    <Screen>
      <Card onPress={() => router.push("/profile")}>
        <Row gap={space.md}>
          <Avatar name={profile?.full_name} size={52} />
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="subheading">{profile?.full_name}</AppText>
            <AppText variant="caption" muted>{profile?.email}</AppText>
            <AppText variant="caption" muted>{ROLES[profile?.role ?? ""] ?? profile?.role}</AppText>
          </View>
        </Row>
      </Card>

      {section([
        { icon: "document-text-outline", title: "Quotations", subtitle: "Create, approve and track quotations", href: "/quotations" },
        { icon: "mail-unread-outline", title: "Email campaigns", subtitle: "Status, approve, pause and resume", href: "/campaigns", show: isManager },
        { icon: "notifications-outline", title: "Notifications", href: "/notifications" },
        { icon: "bar-chart-outline", title: "Analytics & reports", href: "/analytics" },
        { icon: "people-circle-outline", title: "Team", subtitle: "Members and performance", href: "/team", show: isManager },
      ])}

      {section([
        { icon: "cloud-upload-outline", title: "Import Excel database", subtitle: "Opens the web CRM (needs a computer for big files)", url: `${WEB_URL}/import`, show: isAdmin },
        { icon: "options-outline", title: "Smart classification rules", subtitle: "Opens the web CRM", url: `${WEB_URL}/classification`, show: isManager },
        { icon: "settings-outline", title: "CRM settings, services & prices", subtitle: "Opens the web CRM", url: `${WEB_URL}/settings` },
        { icon: "sparkles-outline", title: "AI sales assistant", subtitle: "Opens the web CRM", url: `${WEB_URL}/assistant` },
        { icon: "open-outline", title: "Open full web CRM", subtitle: WEB_URL.replace(/^https?:\/\//, ""), url: WEB_URL },
      ])}

      {section([
        { icon: "person-circle-outline", title: "My profile & password", href: "/profile" },
      ])}
      <Card padded={false} style={{ paddingHorizontal: space.lg }}>
        <ListItem icon="log-out-outline" title="Sign out" danger chevron={false} onPress={() =>
          Alert.alert("Sign out?", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Sign out", style: "destructive", onPress: signOut }])} />
      </Card>
      <AppText variant="caption" faint style={{ textAlign: "center" }}>PIXhub CRM v{Constants.expoConfig?.version ?? "1.0.0"} · © PIXhub.lk</AppText>
    </Screen>
  );
}
