import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 网页版构建：与扩展共用 src/ 下的同一套界面代码，
// 产物为纯静态文件，由 Worker 托管（API 同域，无跨域问题）
export default defineConfig({
  root: "web",
  // 静态资产用仓库根 public/（icon + privacy.html，与扩展 WXT 的 publicDir 同一目录）；
  // web/ 下不设 public，开发服务器与构建产物才能都拿到 /icon、/privacy.html
  publicDir: "../public",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
  },
});
