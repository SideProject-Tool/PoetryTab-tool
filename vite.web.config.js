import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 网页版构建：与扩展共用 src/ 下的同一套界面代码，
// 产物为纯静态文件，由 Worker 托管（API 同域，无跨域问题）
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "web/index.html"),
    },
  },
});
