import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  zip: {
    excludeSources: ["release", "release/**"],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    permissions: [],
    host_permissions: ["https://sync.pathmemos.com/*"],
    author: "xxnuo",
    name: "Proton Collect",
    description: "Proton Collect - 在新标签页上展示中国经典诗词和收藏夹书签。",
    action: {
      default_icon: {
        16: "icon/16.png",
        24: "icon/24.png",
        32: "icon/32.png",
        48: "icon/48.png",
        64: "icon/64.png",
        128: "icon/128.png",
      },
      default_title: "Proton Collect",
    },
  },
});
