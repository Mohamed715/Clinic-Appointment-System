import type { Config } from "tailwindcss";

export default {
  content: ["./public/index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;