import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  base: "/siege/", plugins: [react(), tailwindcss()],
  build: { rollupOptions: { input: {
    workshop: fileURLToPath(new URL("./index.html", import.meta.url)),
    play: fileURLToPath(new URL("./play/index.html", import.meta.url)),
  } } },
  server: { port: Number(process.env.SIEGE_WEB_PORT || 13107), strictPort: true,
    proxy: { "/api/siege": { target: "http://127.0.0.1:" + (process.env.SIEGE_API_PORT || 18107), changeOrigin: false } } },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], include: ["src/**/*.test.{ts,tsx}"] },
});
