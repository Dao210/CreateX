import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/deal/",
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.DEAL_WEB_PORT || 13106),
    strictPort: true,
    proxy: {
      "/api/deal": {
        target: `http://127.0.0.1:${process.env.DEAL_API_PORT || 18106}`,
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
