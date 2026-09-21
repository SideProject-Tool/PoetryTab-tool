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
    // 固定公钥 → 扩展 ID 不随本地加载路径变化（商店发布亦沿用此 ID）
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiZOLyQxiuWC9SkQMfawpuKimB6QWDi1qjNhmm8KbwQt7KWXMzNJZ9NaC3JudMclFuyx1NYGwQwcJjhaT5wkqXH8l+I6KMxuOG87deKvLs7MIWyIHIYVOB/BuNLGf1VJbQVmVLI89HnNysWBLDYfWy6PH0xrsyy4cDBcASgYBT7E97Ur/zz1Kt2Pifn78nXeeBQJYI5eEDWr3xWUlMkJEXuwxxTGFQq26/nhxjregI7sESPXNcCIUlNe6/LvTgpBlEhlzGonGvyUES338FyQ5nmvvfDM1v5PWcLxKOrW9uG+WQqMCrOz7ljI+j+y2gQy1/T/9cPWLCAaw4tNaWHkvpQIDAQAB",
    permissions: [],
    host_permissions: ["https://sync.pathmemos.com/*"],
    author: "startnewlabs",
    name: "Poetry-Tab",
    description: "Poetry-Tab - 在新标签页上展示中国经典诗词和收藏夹书签。",
    action: {
      default_icon: {
        16: "icon/16.png",
        24: "icon/24.png",
        32: "icon/32.png",
        48: "icon/48.png",
        64: "icon/64.png",
        128: "icon/128.png",
      },
      default_title: "Poetry-Tab",
    },
  },
});
