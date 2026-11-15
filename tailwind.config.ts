import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"] },
      colors: {
        navy: { DEFAULT: "#0A2540", 900: "#071a2e", 800: "#0A2540", 700: "#12345a", 600: "#1b4673" },
        brand: { DEFAULT: "#0052CC", 50: "#e8f0fc", 100: "#cce0fa", 500: "#1f6fe0", 600: "#0052CC", 700: "#0043a8" },
      },
      boxShadow: { card: "0 1px 2px rgba(10,37,64,.06), 0 1px 3px rgba(10,37,64,.08)" },
    },
  },
  plugins: [],
};
export default config;
