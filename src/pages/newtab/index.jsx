import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import fontUrl from "../../../assets/fonts/build/JXZhuoKai/JXZhuoKai-subset.woff2?url";

/* 字体预加载：拙楷是首屏视觉核心，但浏览器要等 CSS+布局发现缺字才拉取；
   经 ?url 导入拿到 hash 文件名，模块求值期注入 preload 抢先并行抓取 */
const fontPreload = document.createElement("link");
fontPreload.rel = "preload";
fontPreload.as = "font";
fontPreload.type = "font/woff2";
fontPreload.crossOrigin = "anonymous";
fontPreload.href = fontUrl;
document.head.appendChild(fontPreload);

const root = document.getElementById("root");
const rootContainer = ReactDOM.createRoot(root);
rootContainer.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
