/**
 * 내친구 케이 디자인 토큰 — Tailwind v3
 * 사용법: 기존 tailwind.config.js 의 theme.extend 에 아래 값을 병합한다.
 * 폰트(Pretendard/Gaegu)는 tokens.css 또는 CDN 으로 로드되어 있어야 한다.
 *
 * 예) className="bg-warm-white text-body"
 *     className="bg-primary text-white rounded-md shadow-soft"
 *     className="font-brand text-coral"
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // brand
        primary:   { DEFAULT: "#1A6B5A", 600: "#175E4F", 700: "#124C40" },
        secondary: { DEFAULT: "#2D9F8F", 600: "#238270" },
        coral:     { DEFAULT: "#E8845A", 600: "#D9714A" },
        // surfaces
        "warm-white": "#FAFAF8",
        surface:      "#FFFFFF",
        // text
        charcoal: "#1E1E2D",
        body:     "#3A3A4A",
        muted:    "#8A8A97",
        // tints & line
        tint:        "#ECF5F2",
        "coral-tint":"#FBECE3",
        hairline:    "#E7ECEA",
        // semantic
        success: { DEFAULT: "#1A6B5A", bg: "#ECF5F2" },
        info:    { DEFAULT: "#2D9F8F", bg: "#E4F2EF" },
        warning: { DEFAULT: "#E8A54A", bg: "#FBF0DD" },
        danger:  { DEFAULT: "#D9534F", bg: "#FBE9E8" },
      },
      fontFamily: {
        sans:  ['"Pretendard Variable"', "Pretendard", "-apple-system",
                '"Apple SD Gothic Neo"', '"Malgun Gothic"', "sans-serif"],
        brand: ['"Gaegu"', "Pretendard", "sans-serif"],
      },
      borderRadius: {
        sm: "8px", md: "12px", lg: "16px", xl: "24px", full: "999px",
      },
      boxShadow: {
        soft: "0 6px 24px rgba(26,107,90,0.12)",
        pop:  "0 10px 32px rgba(26,107,90,0.18)",
      },
    },
  },
  plugins: [],
};
