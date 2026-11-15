import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Loading } from "@/components/ui";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useTheme } from "@/theme";

function Gate() {
  const { loading, session, profile } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const t = useTheme();

  useEffect(() => {
    if (loading) return;
    const onLogin = segments[0] === "login";
    if (!session || !profile) { if (!onLogin) router.replace("/login"); }
    else if (onLogin) router.replace("/");
  }, [loading, session, profile, segments, router]);

  if (loading) return <Loading label="Starting PIXhub CRM…" />;

  const nav = t.dark ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={{ ...nav, colors: { ...nav.colors, primary: t.primary, background: t.bg, card: t.card, text: t.text, border: t.border } }}>
      <StatusBar style={t.dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShadowVisible: false, headerStyle: { backgroundColor: t.bg }, headerTintColor: t.text, headerBackButtonDisplayMode: "minimal", contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="lead/[id]" options={{ title: "Lead" }} />
        <Stack.Screen name="lead/edit" options={{ title: "Lead details", presentation: "modal" }} />
        <Stack.Screen name="task/[id]" options={{ title: "Task" }} />
        <Stack.Screen name="task/new" options={{ title: "New task", presentation: "modal" }} />
        <Stack.Screen name="quotations/index" options={{ title: "Quotations" }} />
        <Stack.Screen name="quotations/[id]" options={{ title: "Quotation" }} />
        <Stack.Screen name="quotations/new" options={{ title: "New quotation", presentation: "modal" }} />
        <Stack.Screen name="campaigns/index" options={{ title: "Email campaigns" }} />
        <Stack.Screen name="campaigns/[id]" options={{ title: "Campaign" }} />
        <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
        <Stack.Screen name="analytics" options={{ title: "Analytics" }} />
        <Stack.Screen name="team" options={{ title: "Team" }} />
        <Stack.Screen name="profile" options={{ title: "My profile" }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
