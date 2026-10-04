import type { Config } from "tailwindcss";

// Type scale: 12 / 14 / 16 / 18 / 20 / 24 / 30 / 36 / 48, body at 16 px with a
// 1.55 line height, headings tighter as the size grows.
const SANS = [
  "var(--font-sans)",
  "ui-sans-serif",
  "system-ui",
  "-apple-system",
  "Segoe UI",
  "Roboto",
  "Helvetica Neue",
  "Arial",
  "sans-serif",
];

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: SANS,
      },
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1rem" }],
        sm: ["0.875rem", { lineHeight: "1.375rem" }],
        base: ["1rem", { lineHeight: "1.55" }],
        lg: ["1.125rem", { lineHeight: "1.6" }],
        xl: ["1.25rem", { lineHeight: "1.4" }],
        "2xl": ["1.5rem", { lineHeight: "1.3", letterSpacing: "-0.01em" }],
        "3xl": ["1.875rem", { lineHeight: "1.2", letterSpacing: "-0.015em" }],
        "4xl": ["2.25rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        "5xl": ["3rem", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
          hover: "hsl(var(--muted-hover))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        student: {
          DEFAULT: "hsl(var(--student))",
          foreground: "hsl(var(--student-foreground))",
        },
        flag: "hsl(var(--flag))",
      },
      borderRadius: {
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 hsl(205 40% 11% / 0.05)",
      },
    },
  },
  plugins: [],
} satisfies Config;
