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
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
        display: ["Space Grotesk", "ui-sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace"],
      },
      colors: {
        brand: {
          50: "oklch(97% 0.02 250)",
          100: "oklch(93% 0.04 250)",
          500: "oklch(58% 0.18 250)",
          600: "oklch(52% 0.20 250)",
          700: "oklch(45% 0.22 250)",
          900: "oklch(28% 0.15 250)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
