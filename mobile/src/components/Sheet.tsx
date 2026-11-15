import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResponsive } from "@/hooks/useResponsive";
import { radius, space, useTheme } from "@/theme";
import { AppText, IconButton, Row } from "./ui";

/** Bottom sheet with arbitrary content (forms). */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { contentWidth } = useResponsive();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={{ flex: 1, backgroundColor: t.overlay }} onPress={onClose} />
        <View style={{ backgroundColor: t.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "88%", width: "100%", maxWidth: contentWidth, alignSelf: "center" }}>
          <View style={{ alignItems: "center", paddingTop: 10 }}><View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: t.border }} /></View>
          <Row style={{ justifyContent: "space-between", paddingHorizontal: space.lg, paddingTop: space.sm }}>
            <AppText variant="subheading">{title}</AppText>
            <IconButton icon="close" label="Close" onPress={onClose} />
          </Row>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xl }}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
