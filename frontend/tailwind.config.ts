import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#16241D",
          700: "#24352C",
          600: "#33473C",
        },
        paper: {
          DEFAULT: "#F6F4EE",
          dim: "#EEEADD",
          line: "#DAD3C1",
        },
        amber: {
          DEFAULT: "#E4A33B",
          dim: "#F3D9A6",
          deep: "#B87A1F",
        },
        teal: {
          DEFAULT: "#1F6B66",
          dim: "#CFE3E0",
          deep: "#144B47",
        },
        rust: {
          DEFAULT: "#C0503A",
          dim: "#F0D4CB",
          deep: "#8F3A29",
        },
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "ui-serif", "Georgia", "serif"],
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        stub: "0 1px 0 rgba(22,36,29,0.06)",
        card: "0 12px 28px -18px rgba(22,36,29,0.35)",
      },
      borderRadius: {
        stub: "18px",
      },
      keyframes: {
        "rise-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "stamp-in": {
          "0%": { opacity: "0", transform: "scale(1.3) rotate(-8deg)" },
          "60%": { opacity: "1", transform: "scale(0.96) rotate(-8deg)" },
          "100%": { opacity: "1", transform: "scale(1) rotate(-8deg)" },
        },
      },
      animation: {
        "rise-in": "rise-in 0.5s cubic-bezier(0.16,1,0.3,1) both",
        "stamp-in": "stamp-in 0.4s cubic-bezier(0.16,1,0.3,1) both",
      },
    },
  },
  plugins: [],
};
export default config;
