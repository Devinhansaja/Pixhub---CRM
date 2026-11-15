import { useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, ScrollView, View } from "react-native";
import { WEB_URL } from "@/lib/constants";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppText, Button, Card, ErrorBox, Input, Notice } from "@/components/ui";
import { useResponsive } from "@/hooks/useResponsive";
import { useAuth } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase";
import { radius, space, useTheme } from "@/theme";

export default function Login() {
  const t = useTheme();
  const { isTablet } = useResponsive();
  const { signIn, error: authError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async () => {
    if (!email || !password) { setError("Enter your email and password."); return; }
    setBusy(true); setError(null); setInfo(null);
    const e = await signIn(email, password);
    setBusy(false);
    if (e) setError(e);
  };

  // Password resets finish on the web CRM (the emailed link opens there), so send the user to its login page.
  const reset = () => {
    setInfo("Opening the web CRM — tap “Forgot password?” there to get a reset link.");
    Linking.openURL(`${WEB_URL}/login`).catch(() => setError("Couldn't open the browser."));
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.navy }}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.xl }} keyboardShouldPersistTaps="handled">
            <View style={{ width: "100%", maxWidth: isTablet ? 440 : 520, alignSelf: "center", gap: space.xl }}>
              <View style={{ alignItems: "center", gap: space.md }}>
                <View style={{ width: 64, height: 64, borderRadius: radius.lg, backgroundColor: "#2563eb", alignItems: "center", justifyContent: "center" }}>
                  <AppText variant="title" color="#fff">P</AppText>
                </View>
                <AppText variant="title" color="#fff">PIXhub Sales CRM</AppText>
                <AppText color="#cbd5e1" style={{ textAlign: "center" }}>Leads, follow-ups, quotations and campaigns — in your pocket.</AppText>
              </View>
              <Card style={{ gap: space.lg, padding: space.xl }}>
                <AppText variant="heading">Sign in</AppText>
                {!supabaseConfigured && <Notice tone="danger" icon="warning">The app isn&apos;t configured: EXPO_PUBLIC_SUPABASE_URL / ANON_KEY are missing.</Notice>}
                {(error || authError) && <ErrorBox message={(error || authError)!} />}
                {info && <Notice tone="success" icon="checkmark-circle">{info}</Notice>}
                <Input label="Email" icon="mail-outline" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" returnKeyType="next" />
                <Input label="Password" icon="lock-closed-outline" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} />
                <Button title="Sign in" onPress={submit} loading={busy} full />
                <Button title="Forgot password?" variant="ghost" onPress={reset} disabled={busy} />
              </Card>
              <AppText variant="caption" color="#94a3b8" style={{ textAlign: "center" }}>Use the account your administrator created for you. © PIXhub.lk</AppText>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
