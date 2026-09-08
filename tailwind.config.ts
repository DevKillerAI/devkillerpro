import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        obsidian: {
          950: "#0F172A",
          900: "#1E293B",
          850: "#334155",
          800: "#475569",
          700: "#64748B",
        },
        mineral: {
          300: "#5EEAD4",
          400: "#2DD4BF",
          500: "#0284C7",
          600: "#0369A1",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"],
      },
      boxShadow: {
        soft: "0 10px 30px -5px rgba(24, 39, 75, 0.05), 0 0 1px 1px rgba(24, 39, 75, 0.02)",
        card: "0 15px 35px -5px rgba(24, 39, 75, 0.06), 0 0 1px 1px rgba(24, 39, 75, 0.04)",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
        "4xl": "2rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
