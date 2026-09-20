import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const cwd = process.cwd();
const extDir = path.join(cwd, ".output", "chrome-mv3");
const keyFile = path.join(cwd, "assets", "dev-key.pem");

// Chrome --pack-extension 生成 CRX
// 需要有头模式（打包操作不走渲染管线，headless 也可）
const chromePath = execSync(
  `powershell -NoProfile -Command "(Get-Item (Get-Process chrome | Select-Object -First 1 -ExpandProperty Path)).FullName"`,
  { encoding: "utf8", timeout: 5000 }
).trim();

console.log("Chrome path:", chromePath);

// 使用 --pack-extension
execSync(`"${chromePath}" --pack-extension="${extDir}" --pack-extension-key="${keyFile}" --no-first-run`, {
  cwd, timeout: 15000
});

const crxPath = extDir + ".crx";
const crxSize = fs.statSync(crxPath).size;
console.log("CRX 打包成功:", crxPath, crxSize, "bytes");
