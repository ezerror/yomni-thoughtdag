import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "../upstream/node_modules/playwright-core/index.mjs";

const root = resolve(import.meta.dirname, "../dist/ui");
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(root + sep)) throw new Error("Outside frontend root");
    response.setHeader("content-type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" })[extname(file)] ?? "application/octet-stream");
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.addInitScript(() => {
    window.historyActive = 0;
    window.historyMax = 0;
    window.yomniPlugin = {
      requestConversation: async input => {
        if (input.workspaceKey !== "thoughtdag") throw new Error("Wrong workspace");
        window.lastNativeQuestion = input.content;
        window.lastNativeRequest = input;
        return { sessionId: "native-session" };
      },
      listModels: async () => [{ id: "yomni/native", name: "Yomni", provider: "Yomni", vision: false, efforts: ["medium"], defaultEffort: "medium" }],
      pickWorkspaceDirectory: async () => "C:\\canvas-work",
      onThemeChanged: listener => { window.yomniThemeChanged = listener; return () => { delete window.yomniThemeChanged; }; },
      setTheme: async () => {},
      snapshot: async () => ({ theme: { mode: "light" }, conversation: { sessionId: "native-session", messages: [{ role: "assistant", text: "Native answer" }], run: { status: "completed" } } }),
      action: async (_action, value) => {
        window.historyActive++;
        window.historyMax = Math.max(window.historyMax, window.historyActive);
        await new Promise(resolve => setTimeout(resolve, 20));
        window.historyActive--;
        return { view: { data: { bridgeResult: { id: JSON.parse(value).id, value: { messages: [{ role: "user", text: "Question" }, { role: "assistant", text: "Native answer" }], run: { status: "completed" } } } } } };
      },
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator(".react-flow").first().waitFor({ timeout: 15000 }).catch(async error => { throw new Error(`${error.message}\nPage errors: ${errors.join('; ')}\nBody: ${(await page.locator('body').innerText()).slice(0, 500)}`); });
  await page.locator('[data-yomni-cwd]').click();
  await page.locator('[data-yomni-cwd-pick]').click();
  await page.locator('[data-yomni-cwd]').filter({ hasText: 'canvas-work' }).waitFor();
  const bridge = await page.evaluate(async () => {
    const models = await fetch("/api/models").then(response => response.json());
    const stream = await fetch("/api/stream", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "Question" }] }) }).then(response => response.text());
    return { models, stream, question: window.lastNativeQuestion, request: window.lastNativeRequest };
  });
  if (bridge.models.default !== "yomni/native" || !bridge.stream.includes("Native answer") || bridge.question !== "Question" || bridge.request.workspacePath !== "C:\\canvas-work" || !bridge.request.canvasId) throw new Error("Yomni model/workspace bridge did not answer");
  const concurrent = await page.evaluate(async () => {
    const body = JSON.stringify({ messages: [{ role: "user", content: "Question" }] });
    const replies = await Promise.all([0, 1].map(() => fetch("/api/claude", { method: "POST", body }).then(response => response.json())));
    return { replies, maxHistoryCalls: window.historyMax };
  });
  if (concurrent.replies.some(reply => reply.text !== "Native answer") || concurrent.maxHistoryCalls !== 1) throw new Error("Yomni history bridge did not serialize concurrent reads");
  const screenshots = resolve(import.meta.dirname, "../release/ui-recheck");
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: resolve(screenshots, "light.png") });
  await page.evaluate(() => window.yomniThemeChanged({ mode: "dark" }));
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await page.screenshot({ path: resolve(screenshots, "dark.png") });
  await page.setViewportSize({ width: 800, height: 600 });
  await page.screenshot({ path: resolve(screenshots, "dark-narrow.png") });
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write(`ThoughtDAG SPA and Yomni model/history bridge rendered in browser: ${await page.title()}\n`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
