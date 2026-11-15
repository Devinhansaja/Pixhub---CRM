import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { useCallback, useState } from "react";
import { Pressable, Text, View, type ColorValue } from "react-native";
import { useResponsive } from "@/hooks/useResponsive";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/theme";

function BellButton() {
  const t = useTheme();
  const router = useRouter();
  const { profile } = useAuth();
  const [unread, setUnread] = useState(0);
  useFocusEffect(useCallback(() => {
    if (!profile) return;
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", profile.id).is("read_at", null)
      .then(({ count }) => setUnread(count ?? 0));
  }, [profile]));
  return (
    <Pressable accessibilityLabel="Notifications" onPress={() => router.push("/notifications")} style={{ paddingHorizontal: 16 }} hitSlop={8}>
      <Ionicons name="notifications-outline" size={23} color={t.text} />
      {unread > 0 && (
        <View style={{ position: "absolute", right: 10, top: -4, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: t.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 }}>
          <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{unread > 99 ? "99+" : unread}</Text>
        </View>
      )}
    </Pressable>
  );
}

export default function TabsLayout() {
  const t = useTheme();
  const { isTablet } = useResponsive();
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;
  return (
    <Tabs
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.text,
        headerTitleStyle: { fontWeight: "700" },
        headerRight: () => <BellButton />,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textFaint,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarLabelPosition: isTablet ? "beside-icon" : "below-icon",
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Dashboard", tabBarIcon: icon("grid-outline") }} />
      <Tabs.Screen name="leads" options={{ title: "Leads", tabBarIcon: icon("people-outline") }} />
      <Tabs.Screen name="pipeline" options={{ title: "Pipeline", tabBarIcon: icon("git-branch-outline") }} />
      <Tabs.Screen name="tasks" options={{ title: "Tasks", tabBarIcon: icon("checkbox-outline") }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: icon("menu-outline") }} />
    </Tabs>
  );
}
