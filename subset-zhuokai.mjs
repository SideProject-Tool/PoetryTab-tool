import subsetFont from "subset-font";
import fs from "node:fs/promises";
import path from "node:path";

async function collectTextFiles(dir, files) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectTextFiles(full, files);
    else if (/\.(jsx?|json|html|css|mjs)$/.test(entry.name)) files.push(full);
  }
}

const textSrc = [];
await collectTextFiles("./src", textSrc);
await collectTextFiles("./entrypoints", textSrc);
await collectTextFiles("./node_modules/sentences-bundle/sentences", textSrc);
textSrc.push("./node_modules/sentences-bundle/categories.json");

let text = "";
for (const src of textSrc) text += await fs.readFile(src, "utf-8");
// 补充 ASCII 可打印字符与常用中文标点，保证输入框、数字等不缺字
text += "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`~!@#$%^&*()-_=+[]{};:'\",.<>/?|\ ";
const charset = [...new Set(text)].join("");
console.log("唯一字符数:", charset.length);

const input = await fs.readFile("assets/fonts/.src/JXZhuoKai.ttf");
const out = await subsetFont(input, charset, { targetFormat: "woff2" });
await fs.mkdir("assets/fonts/build/JXZhuoKai", { recursive: true });
await fs.writeFile("assets/fonts/build/JXZhuoKai/JXZhuoKai-subset.woff2", out);
console.log("输出:", out.length, "bytes =", (out.length / 1024 / 1024).toFixed(2), "MB");
