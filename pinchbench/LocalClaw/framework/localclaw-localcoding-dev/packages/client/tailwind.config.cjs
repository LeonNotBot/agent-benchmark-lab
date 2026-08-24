/** @type {import("tailwindcss").Config} */
module.exports = {
  content: ["./src/**/*.{html,ts,tsx}"],
  darkMode: ["selector", '[data-mode="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "PingFang SC", "Noto Sans SC", "system-ui", "-apple-system", "sans-serif"],
        mono: ["Cascadia Code", "Söhne Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      },
      colors: {
        surface: {
          DEFAULT: "#FFFFFF",
          secondary: "#F8F9FC",
          tertiary: "#F1F3F8",
          cream: "#E5E7F0",
          light: "rgba(255,255,255,.6)"
        },
        "purple-light": "hsl(var(--purple-light) / <alpha-value>)",
        "purple-light2": "hsl(var(--purple-light2) / <alpha-value>)",
        "purple-light3": "hsl(var(--purple-light3) / <alpha-value>)",
        ink: {
          900: "#1A1D2E",
          800: "#4B5563",
          700: "#6B7280",
          600: "#9CA3AF"
        },
        muted: {
          DEFAULT: "#9CA3AF",
          light: "#D1D5DB"
        },
        accent: {
          DEFAULT: "#6366F1",
          hover: "#4F46E5",
          light: "#EEF2FF",
          subtle: "#F5F3FF"
        },
        primary: {
          DEFAULT: "#6366F1",
          light: "#818CF8",
          dark: "#4F46E5",
          bg: "#EEF2FF",
          "bg-hover": "#E0E7FF"
        },
        secondary: {
          DEFAULT: "#8B5CF6",
          light: "#A78BFA",
          bg: "#F5F3FF"
        },
        error: {
          DEFAULT: "#EF4444",
          light: "#FEF2F2"
        },
        info: {
          DEFAULT: "#6366F1",
          light: "#EEF2FF"
        },
        "always-white": "hsl(var(--always-white) / <alpha-value>)",
        "always-black": "hsl(var(--always-black) / <alpha-value>)",
        "accent-brand": "hsl(var(--accent-brand) / <alpha-value>)",
        "accent-text": "hsl(var(--accent-text) / <alpha-value>)",
        "accent-main": {
          "000": "hsl(var(--accent-main-000) / <alpha-value>)",
          "100": "hsl(var(--accent-main-100) / <alpha-value>)",
          "200": "hsl(var(--accent-main-200) / <alpha-value>)",
          "900": "hsl(var(--accent-main-900) / <alpha-value>)"
        },
        "accent-pro": {
          "000": "hsl(var(--accent-pro-000) / <alpha-value>)",
          "100": "hsl(var(--accent-pro-100) / <alpha-value>)",
          "200": "hsl(var(--accent-pro-200) / <alpha-value>)",
          "900": "hsl(var(--accent-pro-900) / <alpha-value>)"
        },
        "accent-secondary": {
          "000": "hsl(var(--accent-secondary-000) / <alpha-value>)",
          "100": "hsl(var(--accent-secondary-100) / <alpha-value>)",
          "200": "hsl(var(--accent-secondary-200) / <alpha-value>)",
          "900": "hsl(var(--accent-secondary-900) / <alpha-value>)"
        },
        bg: {
          "000": "hsl(var(--bg-000) / <alpha-value>)",
          "100": "hsl(var(--bg-100) / <alpha-value>)",
          "200": "hsl(var(--bg-200) / <alpha-value>)",
          "300": "hsl(var(--bg-300) / <alpha-value>)",
          "400": "hsl(var(--bg-400) / <alpha-value>)",
          "500": "hsl(var(--bg-500) / <alpha-value>)",
          "600": "hsl(var(--bg-600) / <alpha-value>)"
        },
        border: {
          "100": "hsl(var(--border-100) / <alpha-value>)",
          "200": "hsl(var(--border-200) / <alpha-value>)",
          "300": "hsl(var(--border-300) / <alpha-value>)",
          "400": "hsl(var(--border-400) / <alpha-value>)"
        },
        danger: {
          "000": "hsl(var(--danger-000) / <alpha-value>)",
          "100": "hsl(var(--danger-100) / <alpha-value>)",
          "200": "hsl(var(--danger-200) / <alpha-value>)",
          "900": "hsl(var(--danger-900) / <alpha-value>)"
        },
        oncolor: {
          "100": "hsl(var(--oncolor-100) / <alpha-value>)",
          "200": "hsl(var(--oncolor-200) / <alpha-value>)",
          "300": "hsl(var(--oncolor-300) / <alpha-value>)"
        },
        pictogram: {
          "100": "hsl(var(--pictogram-100) / <alpha-value>)",
          "200": "hsl(var(--pictogram-200) / <alpha-value>)",
          "300": "hsl(var(--pictogram-300) / <alpha-value>)",
          "400": "hsl(var(--pictogram-400) / <alpha-value>)"
        },
        success: {
          DEFAULT: "#10B981",
          light: "#ECFDF5",
          "000": "hsl(var(--success-000) / <alpha-value>)",
          "100": "hsl(var(--success-100) / <alpha-value>)",
          "200": "hsl(var(--success-200) / <alpha-value>)",
          "900": "hsl(var(--success-900) / <alpha-value>)"
        },
        text: {
          "000": "hsl(var(--text-000) / <alpha-value>)",
          "100": "hsl(var(--text-100) / <alpha-value>)",
          "200": "hsl(var(--text-200) / <alpha-value>)",
          "300": "hsl(var(--text-300) / <alpha-value>)",
          "400": "hsl(var(--text-400) / <alpha-value>)",
          "500": "hsl(var(--text-500) / <alpha-value>)"
        },
        warning: {
          "000": "hsl(var(--warning-000) / <alpha-value>)",
          "100": "hsl(var(--warning-100) / <alpha-value>)",
          "200": "hsl(var(--warning-200) / <alpha-value>)",
          "900": "hsl(var(--warning-900) / <alpha-value>)"
        }
      },
      boxShadow: {
        soft: "0 1px 3px rgba(99, 102, 241, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)",
        card: "0 4px 20px rgba(99, 102, 241, 0.06), 0 1px 4px rgba(0, 0, 0, 0.02)",
        elevated: "0 8px 32px rgba(99, 102, 241, 0.08), 0 2px 8px rgba(0, 0, 0, 0.03)",
        cta: "0 4px 16px rgba(99, 102, 241, 0.25), 0 2px 4px rgba(139, 92, 246, 0.12)",
        glass: "0 8px 32px rgba(99, 102, 241, 0.06)",
        "inner-soft": "inset 0 1px 2px rgba(99, 102, 241, 0.06)"
      },
      borderRadius: {
        DEFAULT: "12px",
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "28px",
        pill: "999px"
      },
      backgroundImage: {
        "gradient-primary": "linear-gradient(135deg, #60A5FA 0%, #6366F1 50%, #8B5CF6 100%)",
        "gradient-cta": "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
        "gradient-sidebar": "linear-gradient(180deg, #6366F1 0%, #7C3AED 100%)",
        "gradient-light": "linear-gradient(135deg, #EFF6FF 0%, #EEF2FF 50%, #F5F3FF 100%)",
        "gradient-subtle": "linear-gradient(135deg, rgba(96,165,250,0.04) 0%, rgba(139,92,246,0.04) 100%)"
      },
      keyframes: {
        shimmer: {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(120%)" }
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" }
        },
        "view-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        }
      },
      animation: {
        shimmer: "shimmer 1.4s linear infinite",
        "fade-in": "fade-in 0.15s ease-out",
        "view-in": "view-in 0.28s ease"
      }
    }
  },
  plugins: []
};
