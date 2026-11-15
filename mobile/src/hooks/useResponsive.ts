import { useWindowDimensions } from "react-native";

/** Breakpoints: phone < 600 ≤ tablet < 1024 ≤ large. Content is centred with a max width on big screens. */
export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= 600;
  const isLarge = width >= 1024;
  const columns = isLarge ? 4 : isTablet ? 3 : 2;
  const contentWidth = Math.min(width, isLarge ? 1100 : isTablet ? 860 : width);
  const gutter = isTablet ? 24 : 16;
  return { width, height, isTablet, isLarge, columns, contentWidth, gutter, landscape: width > height };
}
