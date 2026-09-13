import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0b0d",
          900: "#121317",
          800: "#1b1d23",
          700: "#2a2d35",
          600: "#3c4049",
          400: "#6b7280",
          200: "#d1d5db",
          50: "#f8f9fa",
        },
        accent: {
          500: "#4f6df5",
          600: "#3d55d1",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
