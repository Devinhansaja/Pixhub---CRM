import { useColorScheme } from "react-native";

const brand = { 50: "#eff6ff", 100: "#dbeafe", 500: "#3b82f6", 600: "#2563eb", 700: "#1d4ed8" };

export const light = {
  dark: false,
  bg: "#f5f7fb",
  card: "#ffffff",
  cardAlt: "#f1f5f9",
  border: "#e2e8f0",
  text: "#0f172a",
  textMuted: "#64748b",
  textFaint: "#94a3b8",
  primary: brand[600],
  primarySoft: brand[50],
  onPrimary: "#ffffff",
  navy: "#0b1b3f",
  success: "#059669",
  successSoft: "#d1fae5",
  warning: "#b45309",
  warningSoft: "#fef3c7",
  danger: "#e11d48",
  dangerSoft: "#ffe4e6",
  overlay: "rgba(15,23,42,0.45)",
};

export type Theme = typeof light;

export const dark: Theme = {
  dark: true,
  bg: "#0b1120",
  card: "#111a2e",
  cardAlt: "#16213a",
  border: "#1f2b45",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  textFaint: "#64748b",
  primary: brand[500],
  primarySoft: "#132449",
  onPrimary: "#ffffff",
  navy: "#0b1b3f",
  success: "#34d399",
  successSoft: "#063b2c",
  warning: "#fbbf24",
  warningSoft: "#3b2a06",
  danger: "#fb7185",
  dangerSoft: "#3f0d1c",
  overlay: "rgba(0,0,0,0.6)",
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };
export const font = { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 26, xxxl: 32 };

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

/** Colour pair for a "tone" (badge background + text) in the current theme. */
export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "violet" | "teal" | "sky" | "orange";
const toneLight: Record<Tone, [string, string]> = {
  neutral: ["#f1f5f9", "#334155"], primary: ["#dbeafe", "#1d4ed8"], success: ["#d1fae5", "#047857"],
  warning: ["#fef3c7", "#92400e"], danger: ["#ffe4e6", "#be123c"], violet: ["#ede9fe", "#6d28d9"],
  teal: ["#ccfbf1", "#0f766e"], sky: ["#e0f2fe", "#0369a1"], orange: ["#ffedd5", "#c2410c"],
};
const toneDark: Record<Tone, [string, string]> = {
  neutral: ["#1e293b", "#cbd5e1"], primary: ["#172554", "#93c5fd"], success: ["#052e22", "#6ee7b7"],
  warning: ["#3b2a06", "#fcd34d"], danger: ["#3f0d1c", "#fda4af"], violet: ["#2e1065", "#c4b5fd"],
  teal: ["#042f2e", "#5eead4"], sky: ["#082f49", "#7dd3fc"], orange: ["#431407", "#fdba74"],
};
export const toneColors = (t: Theme, tone: Tone) => (t.dark ? toneDark : toneLight)[tone];
