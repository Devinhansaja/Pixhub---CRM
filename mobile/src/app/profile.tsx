import { useState } from "react";
import { Alert } from "react-native";
import { AppText, Button, Card, Input, Notice, Screen } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { ROLES } from "@/lib/constants";
import { supabase } from "@/lib/supabase";
import { space } from "@/theme";

export default function ProfileScreen() {
  const { profile, reloadProfile } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState<null | "profile" | "pw">(null);

  const saveProfile = async () => {
    if (!name.trim()) return Alert.alert("Name is required");
    setBusy("profile");
    const { error } = await supabase.from("profiles").update({ full_name: name.trim().slice(0, 120), phone: phone.trim() || null }).eq("id", profile!.id);
    setBusy(null);
    if (error) Alert.alert("Couldn't save", error.message); else { await reloadProfile(); Alert.alert("Saved"); }
  };

  const changePassword = async () => {
    if (pw.length < 8) return Alert.alert("Use at least 8 characters");
    if (pw !== pw2) return Alert.alert("The two passwords don't match");
    setBusy("pw");
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(null);
    if (error) Alert.alert("Couldn't change password", error.message); else { setPw(""); setPw2(""); Alert.alert("Password changed"); }
  };

  return (
    <Screen>
      <Card style={{ gap: space.lg }}>
        <AppText variant="subheading">Profile</AppText>
        <Input label="Full name" value={name} onChangeText={setName} />
        <Input label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Input label="Email" value={profile?.email} editable={false} hint="Ask an admin to change your email." />
        <Input label="Role" value={ROLES[profile?.role ?? ""] ?? ""} editable={false} />
        <Button title="Save profile" onPress={saveProfile} loading={busy === "profile"} />
      </Card>
      <Card style={{ gap: space.lg }}>
        <AppText variant="subheading">Change password</AppText>
        <Input label="New password" value={pw} onChangeText={setPw} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
        <Input label="Repeat new password" value={pw2} onChangeText={setPw2} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
        <Notice icon="shield-checkmark-outline">Use a strong password you don&apos;t use anywhere else.</Notice>
        <Button title="Change password" onPress={changePassword} loading={busy === "pw"} />
      </Card>
    </Screen>
  );
}
