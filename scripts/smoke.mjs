#!/usr/bin/env node
/**
 * 2.4 浏览器冒烟验收脚本（零依赖，只用 Node 24 内置模块 + Chrome DevTools Protocol）。
 *
 * 做什么：
 * 1. 用 node:http 起本地静态服务器，serve 仓库根目录（免 npx / 免装依赖）；
 * 2. 用 Chrome headless 打开 7 个场景：5 个分析页 + 无 hash + 非法 hash 兜底；
 * 3. 用 CDP（Chrome DevTools Protocol）固定视口为 1920×1080、等待看板自检状态 ready 后再读 DOM，
 *    避免 --dump-dom + --virtual-time-budget 的渲染时序竞争；
 * 4. 断言：数据加载完成、页面/标题/指标卡/一句话结论/表格行数、图表容器（ECharts 可用则有 canvas；
 *    CDN 不可用则必须出现降级提示）、无错误条、无未捕获异常、1920×1080 无横向滚动、非法 hash 回落；
 * 5. 结果打印成表，失败原因逐条列出并以非 0 退出。
 *
 * 用法：
 *   node scripts/smoke.mjs            # 或 npm run smoke
 *   SMOKE_BLOCK_ECHARTS=1 npm run smoke   # 模拟 ECharts CDN 不可达，验收降级提示
 *   CHROME_PATH=/path/to/chrome npm run smoke
 *
 * 已知限制：ECharts 走 CDN，正常模式需要联网。CDN 不可达时页面应显示降级提示
 * （图表位置提示、表格仍可读、无错误条），本脚本把这种场景判为通过并在报表里注明「降级模式」。
 */

import http from "node:http";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { analyze } from "../src/engine/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME_PATH =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** 投影分辨率（CDP Emulation 固定，不依赖 headless 窗口装饰）。 */
const VIEWPORT = { width: 1920, height: 1080 };
const PAGE_TIMEOUT_MS = 30_000;
/** 模拟 ECharts CDN 不可达：SMOKE_BLOCK_ECHARTS=1 node scripts/smoke.mjs */
const BLOCK_ECHARTS = process.env.SMOKE_BLOCK_ECHARTS === "1";
/** 页面就绪判定：main.js 会把启动状态/渲染状态写进 #diagnostics 的 data-* 属性。 */
const READY_STATES = new Set(["ready", "error", "fatal"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 期望值：只从 data/ + 引擎推导（与看板同源，用于核对 DOM 行数）
// ---------------------------------------------------------------------------

const input = JSON.parse(readFileSync(path.join(ROOT, "data/revenue_2025-09.json"), "utf8"));
const engine = analyze(input);

/** 每个页面：标题、图表数量、表格行数、必须出现的文本 */
const PAGES = {
  channel: {
    hash: "#/channel",
    title: "渠道收入结构",
    charts: 2,
    tableRows: engine.channel.rows.length + 1,
    tokens: ["渠道明细", "美团大众", "抖音", "31.66%"],
  },
  "store-mix": {
    hash: "#/store-mix",
    title: "同店 / 新店结构与同店渠道拆解",
    charts: 2,
    tableRows: engine.store_mix.channels.length + 1,
    tokens: ["同店渠道拆解", "394.24", "同店收入占比"],
  },
  "store-rank": {
    hash: "#/store-rank",
    title: "门店收入 / 增长额 / 增长率排名",
    charts: 3,
    tableRows:
      engine.store_rank.by_revenue.length +
      engine.store_rank.by_growth_amount.length +
      engine.store_rank.by_growth_rate.length,
    tokens: ["收入排名", "增长额排名", "增长率排名", "门店7", "门店3"],
  },
  category: {
    hash: "#/category",
    title: "品类量价因素分析",
    charts: 1,
    tableRows: engine.category_qty_price.all.length,
    tokens: ["收入因素瀑布图", "全店口径", "同店口径", "主食类"],
  },
  traffic: {
    hash: "#/traffic",
    title: "客流 × 人均销量 × 单价三因素",
    charts: 1,
    tableRows: engine.traffic.categories.length + engine.traffic.stores.length,
    tokens: ["同店品类三因素", "门店客流 × 客单两因素", "客流影响", "客单影响", "111,500"],
  },
};

/** 冒烟场景：5 个分析页 + 无 hash + 非法 hash 两个兜底 */
const SCENARIOS = [
  { id: "no-hash", label: "无 hash 兜底", path: "/", pageId: "channel" },
  { id: "channel", label: "第 1 层 · 渠道结构", path: "/#/channel", pageId: "channel" },
  { id: "store-mix", label: "第 2 层 · 同店 / 新店", path: "/#/store-mix", pageId: "store-mix" },
  { id: "store-rank", label: "第 3 层 · 门店排名", path: "/#/store-rank", pageId: "store-rank" },
  { id: "category", label: "第 4 层 · 品类量价", path: "/#/category", pageId: "category" },
  { id: "traffic", label: "第 5 层 · 客流客单", path: "/#/traffic", pageId: "traffic" },
  { id: "illegal-hash", label: "非法 hash 兜底", path: "/#/this-route-does-not-exist", pageId: "channel" },
];

// ---------------------------------------------------------------------------
// 本地静态服务器
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const filePath = path.resolve(ROOT, `.${pathname}`);
      if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Forbidden");
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not Found");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// ---------------------------------------------------------------------------
// Chrome DevTools Protocol 客户端（Node 24 内置 WebSocket）
// ---------------------------------------------------------------------------

/** 极简 CDP 连接：send 等响应，on 收事件。 */
class CdpConnection {
  constructor(webSocket) {
    this.webSocket = webSocket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    webSocket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.id !== undefined && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.code}: ${message.error.message}`));
        else resolve(message.result);
        return;
      }
      if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.webSocket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }

  close() {
    try {
      this.webSocket.close();
    } catch {
      /* 已关闭 */
    }
  }
}

/** 等 Chrome 写出 DevToolsActivePort（第一行端口，第二行浏览器 WebSocket 路径）。 */
async function waitForDevToolsPort(profileDir, deadline) {
  const portFile = path.join(profileDir, "DevToolsActivePort");
  while (Date.now() < deadline) {
    try {
      const content = await readFile(portFile, "utf8");
      const [port] = content.split(/\r?\n/);
      if (port) return Number(port);
    } catch {
      /* 文件还没写出来，继续等 */
    }
    await sleep(50);
  }
  return null;
}

/** 轮询页面 #diagnostics，直到 data-status 进入 ready/error/fatal 且尺寸自检已写入。 */
async function waitForPageReady(cdp, deadline) {
  let lastDataset = null;
  while (Date.now() < deadline) {
    try {
      const { result } = await cdp.send("Runtime.evaluate", {
        expression:
          "(() => { const node = document.getElementById('diagnostics'); return node ? JSON.stringify(Object.assign({}, node.dataset)) : null; })()",
        returnByValue: true,
      });
      const value = result?.value;
      if (value) {
        const dataset = JSON.parse(value);
        lastDataset = dataset;
        // status 已就绪且 measurePage 的尺寸自检已写入（说明 rAF 已跑过）
        if (READY_STATES.has(dataset.status) && dataset.viewport) return dataset;
      }
    } catch {
      /* 导航过程中执行上下文会短暂不可用，继续轮询 */
    }
    await sleep(80);
  }
  return lastDataset;
}

/**
 * 用 CDP 打开一个页面：固定视口 1920×1080 → 导航 → 等看板就绪 → 读 DOM。
 * @returns {Promise<{dom: string, dataset: object|null, pageErrors: string[], timedOut: boolean, stderr: string}>}
 */
async function renderPage(url) {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "revenue-smoke-profile-"));
  const args = [
    "--headless=new",
    // 本地静态页冒烟：关掉 Chrome 自身沙箱与崩溃上报，避免受限环境起不来
    // （只访问 127.0.0.1 的本地静态服务器，不加载不可信页面）。
    "--no-sandbox",
    "--disable-crash-reporter",
    "--disable-breakpad",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ];
  if (BLOCK_ECHARTS) {
    // 用不可达代理拦掉外部请求（只放行本地），模拟 CDN 不可达。
    args.push("--proxy-server=127.0.0.1:9", "--proxy-bypass-list=127.0.0.1;localhost");
  }

  const child = spawn(CHROME_PATH, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });

  const cleanup = async () => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* 已退出 */
    }
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  };

  const deadline = Date.now() + PAGE_TIMEOUT_MS;
  let cdp = null;
  try {
    const port = await waitForDevToolsPort(profileDir, deadline);
    if (!port) return { dom: "", dataset: null, pageErrors: [], timedOut: true, stderr };

    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const pageTarget = targets.find((target) => target.type === "page");
    if (!pageTarget?.webSocketDebuggerUrl) {
      return { dom: "", dataset: null, pageErrors: [], timedOut: false, stderr: `${stderr}\n找不到页面调试目标` };
    }

    const webSocket = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      webSocket.addEventListener("open", resolve, { once: true });
      webSocket.addEventListener("error", () => reject(new Error("CDP WebSocket 连接失败")), { once: true });
    });
    cdp = new CdpConnection(webSocket);

    const pageErrors = [];
    cdp.on("Runtime.exceptionThrown", (params) => {
      pageErrors.push(params?.exceptionDetails?.exception?.description ?? params?.exceptionDetails?.text ?? "未捕获异常");
    });

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await cdp.send("Page.navigate", { url });
    const dataset = await waitForPageReady(cdp, deadline);
    // 等一帧，确保 measurePage/图表初始化完成
    await sleep(120);

    const { result } = await cdp.send("Runtime.evaluate", {
      expression: "document.documentElement.outerHTML",
      returnByValue: true,
    });
    const dom = result?.value ?? "";
    return {
      dom: String(dom),
      dataset,
      pageErrors,
      timedOut: !dataset || !READY_STATES.has(dataset.status),
      stderr,
    };
  } catch (error) {
    return { dom: "", dataset: null, pageErrors: [], timedOut: false, stderr: `${stderr}\n${error.message}` };
  } finally {
    cdp?.close();
    await cleanup();
  }
}

// ---------------------------------------------------------------------------
// DOM 解析（零依赖，用字符串/正则；DOM 由 CDP 取回，结构确定）
// ---------------------------------------------------------------------------

const stripTags = (html) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

/** 读取 #diagnostics 节点上的 data-* 自检信息（data-scroll-width → scrollWidth） */
function parseDiagnostics(dom) {
  const tag = dom.match(/<div[^>]*id="diagnostics"[^>]*>/)?.[0];
  if (!tag) return null;
  const attrs = {};
  for (const match of tag.matchAll(/data-([a-z-]+)="([^"]*)"/g)) {
    const key = match[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    attrs[key] = match[2];
  }
  return attrs;
}

function parseErrorBar(dom) {
  const tag = dom.match(/<div[^>]*id="error-bar"[^>]*>/)?.[0] ?? "";
  const hidden = /(^|\s)hidden(\s|=|>)/.test(tag);
  const lines = [...dom.matchAll(/<p class="error-line">([\s\S]*?)<\/p>/g)].map((match) =>
    stripTags(match[1]),
  );
  return { hidden, lines };
}

function parseBootFatal(dom) {
  const tag = dom.match(/<div[^>]*id="boot-fatal"[^>]*>/)?.[0] ?? "";
  const hidden = /(^|\s)hidden(\s|=|>)/.test(tag);
  const title = stripTags(dom.match(/<h2 id="boot-fatal-title">([\s\S]*?)<\/h2>/)?.[1] ?? "");
  return { hidden, title };
}

function parseMetricCards(dom) {
  return [...dom.matchAll(/<article class="metric-card[^"]*">([\s\S]*?)<\/article>/g)].map((match) => {
    const html = match[1];
    return {
      label: stripTags(html.match(/<p class="metric-label">([\s\S]*?)<\/p>/)?.[1] ?? ""),
      value: stripTags(html.match(/<p class="metric-value[^"]*">([\s\S]*?)<\/p>/)?.[1] ?? ""),
    };
  });
}

function parseInsight(dom) {
  const bannerTag = dom.match(/<div class="insight"[^>]*>/)?.[0] ?? "";
  const text = stripTags(dom.match(/<p class="insight-text" id="insight-text">([\s\S]*?)<\/p>/)?.[1] ?? "");
  return { hidden: /(^|\s)hidden(\s|=|>)/.test(bannerTag), text };
}

function parsePageTitle(dom) {
  return stripTags(dom.match(/<h1 class="page-title">([\s\S]*?)<\/h1>/)?.[1] ?? "");
}

function parsePageId(dom) {
  return dom.match(/<main[^>]*id="page"[^>]*data-page="([^"]+)"/)?.[1] ?? null;
}

/** 统计所有 <tbody> 里的数据行数（表头在 thead，不计入） */
function countTableRows(dom) {
  let rows = 0;
  for (const match of dom.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)) {
    rows += (match[1].match(/<tr[\s>]/g) ?? []).length;
  }
  return rows;
}

function countActiveNav(dom) {
  return (dom.match(/aria-current="page"/g) ?? []).length;
}

// ---------------------------------------------------------------------------
// 单个场景断言
// ---------------------------------------------------------------------------

function checkScenario(scenario, page, meta) {
  const failures = [];
  const fail = (message) => failures.push(message);
  const dom = meta.dom ?? "";
  const domText = stripTags(
    dom.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, ""),
  );

  if (meta.timedOut) {
    fail(
      `看板未在 ${PAGE_TIMEOUT_MS / 1000}s 内进入 ready 状态（Chrome stderr 摘要：${meta.stderr.slice(0, 300)}）`,
    );
  }
  if (!dom || dom.length < 500) {
    fail(`读不到页面 DOM（长度 ${dom.length}），Chrome stderr 摘要：${meta.stderr.slice(0, 300)}`);
    return { failures, info: {} };
  }
  if (meta.pageErrors?.length) {
    fail(`页面出现未捕获脚本异常：${meta.pageErrors.join(" | ")}`);
  }

  const diagnostics = parseDiagnostics(dom);
  if (!diagnostics) {
    fail("页面缺少 #diagnostics 自检节点（main.js 可能没执行）");
  }

  // 1. 启动状态：必须 ready，不能是 loading / boot / error / fatal
  if (diagnostics && diagnostics.status !== "ready") {
    fail(`启动状态 data-status=${JSON.stringify(diagnostics.status)}，期望 "ready"`);
  }

  // 2. 无错误条、无启动失败浮层
  const errorBar = parseErrorBar(dom);
  if (!errorBar.hidden) fail(`页面出现错误条：${errorBar.lines.join(" | ") || "（无文本）"}`);
  if (diagnostics?.errors && diagnostics.errors !== "0") {
    fail(`diagnostics 记录到 ${diagnostics.errors} 个脚本错误`);
  }
  const bootFatal = parseBootFatal(dom);
  if (!bootFatal.hidden) fail(`页面出现启动失败浮层：${bootFatal.title}`);

  // 3. 路由：正常场景命中自身，无 hash / 非法 hash 必须回落到 #/channel
  const actualRoute = diagnostics?.route ?? null;
  if (actualRoute !== page.hash) {
    fail(`路由未落到 ${page.hash}（data-route=${JSON.stringify(actualRoute)}）`);
  }
  if (actualRoute === "#/this-route-does-not-exist") {
    fail("非法 hash 未被替换（仍停留在非法路由）");
  }

  // 4. 页面 id / 主标题 / 文档标题
  const pageId = parsePageId(dom);
  if (pageId !== scenario.pageId) {
    fail(`#page data-page=${JSON.stringify(pageId)}，期望 ${JSON.stringify(scenario.pageId)}`);
  }
  const pageTitle = parsePageTitle(dom);
  if (!pageTitle.includes(page.title)) {
    fail(`页面主标题=${JSON.stringify(pageTitle)}，期望包含 ${JSON.stringify(page.title)}`);
  }
  const documentTitle = stripTags(dom.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
  if (!documentTitle.includes(page.title)) {
    fail(`文档标题=${JSON.stringify(documentTitle)}，期望包含 ${JSON.stringify(page.title)}`);
  }

  // 5. 五张指标卡都有数字（不是占位的 —）
  const cards = parseMetricCards(dom);
  if (cards.length !== 5) fail(`指标卡数量 ${cards.length}，期望 5`);
  for (const card of cards) {
    if (!card.value || card.value === "—" || card.value === "-") {
      fail(`指标卡「${card.label}」没有数值（value=${JSON.stringify(card.value)}）`);
    }
  }

  // 6. 一句话结论存在且非空
  const insight = parseInsight(dom);
  if (insight.hidden) fail("一句话结论被隐藏（#insight hidden）");
  if (insight.text.length < 5) fail(`一句话结论内容过短/为空：${JSON.stringify(insight.text)}`);

  // 7. 表格行数与引擎结果一致
  const tableRows = countTableRows(dom);
  if (tableRows !== page.tableRows) {
    fail(`表格行数 ${tableRows}，期望 ${page.tableRows}（与 engine 结果一致）`);
  }

  // 8. 图表：ECharts 可用 → canvas；CDN 不可用 → 降级提示（不是报错）
  const echarts = diagnostics?.echarts ?? "unknown";
  const charts = Number(diagnostics?.charts ?? 0);
  if (echarts === "ready") {
    if (!(charts >= page.charts)) fail(`图表 canvas 数量 ${charts}，期望至少 ${page.charts}`);
  } else if (echarts === "missing") {
    if (!dom.includes("图表库未能从 CDN 加载")) {
      fail("ECharts 未加载，但页面没有图表降级提示（应提示 CDN 失败、表格仍可读）");
    }
  } else {
    fail(`无法判断 ECharts 状态（diagnostics.echarts=${JSON.stringify(diagnostics?.echarts)}）`);
  }

  // 9. 该页关键内容存在（表格文字 / 面板标题 / 渠道名等）
  for (const token of page.tokens) {
    if (!domText.includes(token)) fail(`页面内容缺少关键文本：${JSON.stringify(token)}`);
  }

  // 10. 当前层级导航高亮唯一且匹配
  const activeNav = countActiveNav(dom);
  if (activeNav !== 1) fail(`高亮导航数量 ${activeNav}，期望 1`);
  if (!new RegExp(`class="nav-tab active"[^>]*data-route="${scenario.pageId}"`).test(dom)) {
    fail(`导航未高亮 ${scenario.pageId}`);
  }

  // 11. 1920×1080 无横向滚动 + 表格不被内部截断
  const viewport = diagnostics?.viewport ?? "";
  const scrollWidth = Number(diagnostics?.scrollWidth);
  if (viewport !== `${VIEWPORT.width}x${VIEWPORT.height}`) {
    fail(`视口 ${JSON.stringify(viewport)}，期望 ${VIEWPORT.width}x${VIEWPORT.height}`);
  }
  if (!Number.isFinite(scrollWidth)) {
    fail(`缺少尺寸自检信息（scrollWidth=${JSON.stringify(diagnostics?.scrollWidth)}，viewport=${JSON.stringify(viewport)}）`);
  } else {
    if (scrollWidth > VIEWPORT.width) {
      fail(`出现横向滚动：scrollWidth=${scrollWidth} > 视口宽 ${VIEWPORT.width}`);
    }
    const overflow = diagnostics?.tableOverflow;
    if (overflow !== "0") {
      fail(`表格出现内部截断：tableOverflow=${JSON.stringify(overflow)}，tableOverflowPx=${JSON.stringify(diagnostics?.tableOverflowPx)}`);
    }
  }

  return {
    failures,
    info: {
      route: actualRoute,
      echarts,
      charts,
      tableRows,
      insight: insight.text,
      viewport,
      scrollWidth: diagnostics?.scrollWidth ?? "?",
    },
  };
}

// ---------------------------------------------------------------------------
// 报表
// ---------------------------------------------------------------------------

function padEnd(value, width) {
  const text = String(value ?? "");
  // 中文字符按 2 列宽计算，保证表格对齐
  let displayWidth = 0;
  for (const char of text) displayWidth += /[\u4e00-\u9fff]/.test(char) ? 2 : 1;
  return text + " ".repeat(Math.max(0, width - displayWidth));
}

async function main() {
  console.log("收入分析看板 · 浏览器冒烟验收（2.4）");
  console.log(`- Chrome：${CHROME_PATH}`);
  console.log(
    `- 视口：${VIEWPORT.width}×${VIEWPORT.height}（CDP Emulation 固定，投影分辨率）`,
  );
  console.log(
    `- ECharts：${BLOCK_ECHARTS ? "模拟 CDN 不可达（验收降级提示，不联网加载图表库）" : "正常联网加载（CDN: cdn.jsdelivr.net）"}`,
  );
  console.log(`- 场景：${SCENARIOS.length} 个（5 个分析页 + 无 hash + 非法 hash）`);
  console.log("");

  try {
    await readFile(CHROME_PATH);
  } catch {
    console.error(`✖ 找不到 Chrome：${CHROME_PATH}`);
    console.error("  可通过环境变量 CHROME_PATH 指定 Chrome 可执行文件路径。");
    process.exitCode = 1;
    return;
  }

  const { server, baseUrl } = await startStaticServer();
  const results = [];
  let echartsMode = "unknown";

  try {
    for (const scenario of SCENARIOS) {
      const page = PAGES[scenario.pageId];
      const url = `${baseUrl}${scenario.path}`;
      process.stdout.write(`→ 冒烟：${scenario.label}（${url}）… `);
      const meta = await renderPage(url);
      const { failures, info } = checkScenario(scenario, page, meta);
      if (info.echarts && info.echarts !== "unknown") echartsMode = info.echarts;
      results.push({ ...scenario, page, expectedRoute: page.hash, failures, info });
      console.log(failures.length === 0 ? "PASS" : `FAIL（${failures.length}）`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("");
  console.log("冒烟结果：");
  console.log("");

  const headers = ["场景", "期望路由", "实际路由", "表格行", "图表", "结论"];
  const widths = [24, 14, 14, 11, 8, 6];
  console.log(headers.map((header, index) => padEnd(header, widths[index])).join("  "));
  console.log(widths.map((width) => "─".repeat(width)).join("  "));
  for (const row of results) {
    const chartCell = row.info.echarts === "missing" ? "降级" : `${row.info.charts ?? "?"}`;
    console.log(
      [
        padEnd(row.label, widths[0]),
        padEnd(row.expectedRoute, widths[1]),
        padEnd(row.info.route ?? "?", widths[2]),
        padEnd(`${row.info.tableRows ?? "?"}/${row.page.tableRows}`, widths[3]),
        padEnd(chartCell, widths[4]),
        padEnd(row.failures.length === 0 ? "PASS" : "FAIL", widths[5]),
      ].join("  "),
    );
  }

  const failed = results.filter((row) => row.failures.length > 0);
  for (const row of failed) {
    console.log("");
    console.log(`✖ ${row.label}（${row.expectedRoute}）失败原因：`);
    for (const failure of row.failures) console.log(`  - ${failure}`);
  }

  console.log("");
  console.log(
    "提示：如需验收 CDN 不可达时的降级模式，执行 SMOKE_BLOCK_ECHARTS=1 npm run smoke（脚本会断言图表位置出现降级提示、表格仍可读、无错误条）。",
  );
  if (echartsMode === "ready") {
    console.log("图表：ECharts CDN 加载成功，五个页面 canvas 均正常渲染（本轮为联网模式）。");
  } else if (echartsMode === "missing") {
    console.log(
      "图表：ECharts CDN 不可达，页面按设计进入降级模式（图表位置提示、表格数据仍可读、无错误条）。",
    );
    console.log("      本次冒烟对降级模式判通过；联网环境复跑可验证 canvas 渲染。");
  }
  console.log(
    `汇总：${SCENARIOS.length} 个场景，通过 ${results.length - failed.length}，失败 ${failed.length}。`,
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("");
  console.error("✖ 冒烟脚本自身异常：", error);
  process.exitCode = 1;
});
