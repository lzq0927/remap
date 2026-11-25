import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { codespacesViteHosts } from "../../packages/contracts/src/codespaces";
export default defineConfig({
  root: resolve("apps/web"),
  plugins: [react()],
  server: {
    allowedHosts: codespacesViteHosts(process.env),
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
  // 导出 PPT 时才按需加载；预先打包，避免开发服务器首次使用时重新优化依赖并刷新页面
  optimizeDeps: { include: ["pptxgenjs"] },
  build: { outDir: resolve("dist/web"), emptyOutDir: true },
});
