/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: "#0B0C14", card: "#111219", sidebar: "#0E0F17", hover: "rgba(255,255,255,0.03)" },
        border: { DEFAULT: "rgba(255,255,255,0.06)", h: "rgba(255,255,255,0.12)" },
        txt: { DEFAULT: "#E2E0EC", muted: "rgba(255,255,255,0.42)", dim: "rgba(255,255,255,0.22)" },
        brand: { red: "#EF4444", green: "#22C55E", blue: "#3B82F6", purple: "#A855F7", orange: "#F59E0B", pink: "#EC4899", cyan: "#06B6D4", teal: "#14B8A6" },
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      borderRadius: { card: "14px" },
      animation: {
        "fade-in": "fadeIn 0.25s ease-out",
        "slide-in": "slideIn 0.2s ease",
        "toast-in": "toastIn 0.3s ease",
        "toast-out": "toastOut 0.3s ease forwards",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        slideIn: { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(0)" } },
        toastIn: { from: { transform: "translateX(120%)", opacity: "0" }, to: { transform: "translateX(0)", opacity: "1" } },
        toastOut: { from: { transform: "translateX(0)", opacity: "1" }, to: { transform: "translateX(120%)", opacity: "0" } },
      },
    },
  },
  plugins: [],
};
