import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 950: "#060b1a", 900: "#0a1128", 800: "#101a3a", 700: "#1a274f" },
        electric: "#3b82f6",
        violet: "#8b5cf6",
      },
    },
  },
  plugins: [],
};
export default config;
