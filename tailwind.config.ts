import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ecolab: {
          blue: "#0098CC",
          "blue-dark": "#007399",
          "blue-light": "#33ADDB",
          green: "#00A651",
          "green-dark": "#008040",
          "green-light": "#33B872",
          navy: "#003D5C",
          gray: "#5C6B73",
          "gray-light": "#E8ECEE",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
