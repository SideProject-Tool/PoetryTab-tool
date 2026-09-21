const { chromium } = require("playwright");
const path = require("path");
const EXT = path.join(__dirname, "..", ".output", "chrome-mv3");
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, "pw-blank-debug"), {
    headless: true, channel: "chromium", viewport: { width: 1280, height: 800 },
    args: ["--disable-extensions-except=" + EXT, "--load-extension=" + EXT, "--no-first-run"],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 300)));
  await page.goto("about:blank");
  await page.waitForTimeout(3000);
  const extPages = ctx.pages().filter((p) => p.url().includes("chrome-extension"));
  if (!extPages.length) { console.log("no ext page"); await ctx.close(); process.exit(1); }
  const ep = extPages[0];
  const body = await ep.evaluate(() => document.body.innerText.slice(0, 300));
  console.log("body:", body);
  console.log("errors:", JSON.stringify(errs));
  await ep.screenshot({ path: path.join(__dirname, "blank-debug.png") });
  await ctx.close();
  process.exit(0);
})().catch((e) => { console.error("fail:", e.message.split("\n")[0]); process.exit(1); });
