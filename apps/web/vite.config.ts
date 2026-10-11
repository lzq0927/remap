import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  root: resolve("apps/web"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/api":
        process.env.VITE_API_TARGET ??
        `http://127.0.0.1:${process.env.PORT ?? 4178}`,
      "/health":
        process.env.VITE_API_TARGET ??
        `http://127.0.0.1:${process.env.PORT ?? 4178}`,
    },
  },
  build: { outDir: resolve("dist/web"), emptyOutDir: true },
});
