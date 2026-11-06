#!/usr/bin/env node
/**
 * 2.4 浏览器冒烟验收脚本（零依赖，只用 Node 24 内置模块 + Chrome DevTools Protocol）。
 *
 * 做什么：
 * 1. 用 node:http 起本地静态服务器，serve 仓库根目录（免 npx / 免装依赖）；
 * 2. 用 Chrome headless 打开 12 个页面场景：5 个分析页 + 无 hash + 非法 hash 兜底 + 数据导入 / 分析报告
 *    + 本机导入数据注入（看板、报告、损坏回退）；再用 CDP 驱动 6 个导入交互流程
 *    （下载模板往返、模板改数端到端 + 报告 PDF、错误清单、修改导入与恢复、折算标注、取消 / 不支持格式）；
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
import { readFile, rm, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { analyze, denormalize, importWorkbook, toCSV } from "../src/engine/index.js";
import { buildReportModel } from "../src/web/reportModel.js";

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

// 工具页期望值
const reportModel = buildReportModel({ data: input, result: engine, dataset: { source: { type: "demo" }, meta: { derived: [] } } });
const REPORT_TABLE_ROWS =
  engine.channel.rows.length + 1 + // 渠道 + 合计
  3 + // 同店 / 新店 / 门店合计
  Math.min(5, engine.store_rank.by_revenue.length) + // 排名前 5
  engine.category_qty_price.all.length +
  engine.traffic.categories.length;

PAGES.import = {
  hash: "#/import",
  title: "数据导入",
  tool: true,
  charts: 0,
  tableRows: 0,
  tokens: ["① 下载模板", "② 上传数据", "③ 校验结果与预览", "不会上传到服务器"],
};
PAGES.report = {
  hash: "#/report",
  title: "收入分析报告",
  tool: true,
  charts: reportModel.chapters.length,
  tableRows: REPORT_TABLE_ROWS,
  tokens: ["餐饮收入分析报告", "收入总览", "结论汇总", "打印 / 导出 PDF", "演示数据（非真实经营数据）", ...reportModel.chapters.map((c) => c.title)],
};

// 本机已保存导入数据（模拟用户此前导入过）：美团大众本期 460 → 500
const STORAGE_KEY = "canyin.dataset.v1";
const SMOKE_FILE = "smoke-import.xlsx";
const storedSheets = denormalize(input);
storedSheets["渠道"][1][2] = 500;
const storedImport = importWorkbook(storedSheets);
const STORED_ENTRY = JSON.stringify({
  version: 1,
  source: { type: "import", fileName: SMOKE_FILE, importedAt: "2026-11-07T09:30:00.000Z" },
  data: storedImport.data,
  meta: storedImport.meta,
});

/**
 * 冒烟场景：5 个分析页 + 无 hash + 非法 hash + 2 个工具页 + 本机数据注入 3 个。
 * storage：页面加载前写入 localStorage 的值；expect：额外断言（数据来源、提示条、指标卡）。
 */
const SCENARIOS = [
  { id: "no-hash", label: "无 hash 兜底", path: "/", pageId: "channel" },
  { id: "channel", label: "第 1 层 · 渠道结构", path: "/#/channel", pageId: "channel" },
  { id: "store-mix", label: "第 2 层 · 同店 / 新店", path: "/#/store-mix", pageId: "store-mix" },
  { id: "store-rank", label: "第 3 层 · 门店排名", path: "/#/store-rank", pageId: "store-rank" },
  { id: "category", label: "第 4 层 · 品类量价", path: "/#/category", pageId: "category" },
  { id: "traffic", label: "第 5 层 · 客流客单", path: "/#/traffic", pageId: "traffic" },
  { id: "illegal-hash", label: "非法 hash 兜底", path: "/#/this-route-does-not-exist", pageId: "channel" },
  { id: "import", label: "工具 · 数据导入", path: "/#/import", pageId: "import", expect: { source: "demo" } },
  { id: "report", label: "工具 · 分析报告", path: "/#/report", pageId: "report", expect: { source: "demo" } },
  {
    id: "stored-import",
    label: "本机导入数据 · 看板",
    path: "/#/channel",
    pageId: "channel",
    storage: STORED_ENTRY,
    expect: { source: "import", metric: "1040.00", tokens: ["导入数据", SMOKE_FILE, "恢复演示数据", "500.00"] },
  },
  {
    id: "stored-report",
    label: "本机导入数据 · 报告",
    path: "/#/report",
    pageId: "report",
    storage: STORED_ENTRY,
    expect: { source: "import", metric: "1040.00", tokens: [`导入数据：${SMOKE_FILE}`] },
  },
  {
    id: "stored-broken",
    label: "本机数据损坏回退",
    path: "/#/channel",
    pageId: "channel",
    storage: "{broken json",
    expect: { source: "demo", metric: "1000.00", notice: "本机导入数据已失效，已恢复演示数据" },
  },
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
 * 启动 headless Chrome 并连上页面的 CDP（固定视口 1920×1080）。
 * @param {{ storage?: string }} [options] storage：每个新文档加载前写入 localStorage 的值
 * @returns {Promise<{ cdp: CdpConnection|null, pageErrors: string[], close: () => Promise<void>, stderr: () => string, deadline: number }>}
 */
async function launchPage({ storage } = {}) {
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
    // 用不可达代理拦掉外部请求（只放行本地），模拟 CDN 不可达（ECharts 与 SheetJS 都会失败）。
    args.push("--proxy-server=127.0.0.1:9", "--proxy-bypass-list=127.0.0.1;localhost");
  }

  const child = spawn(CHROME_PATH, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });

  const pageErrors = [];
  let cdp = null;
  const close = async () => {
    cdp?.close();
    try {
      child.kill("SIGKILL");
    } catch {
      /* 已退出 */
    }
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  };
  const deadline = Date.now() + PAGE_TIMEOUT_MS;
  const result = { cdp: null, pageErrors, close, stderr: () => stderr, deadline };

  const port = await waitForDevToolsPort(profileDir, deadline);
  if (!port) return result;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const pageTarget = targets.find((target) => target.type === "page");
  if (!pageTarget?.webSocketDebuggerUrl) {
    stderr += "\n找不到页面调试目标";
    return result;
  }

  const webSocket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    webSocket.addEventListener("open", resolve, { once: true });
    webSocket.addEventListener("error", () => reject(new Error("CDP WebSocket 连接失败")), { once: true });
  });
  cdp = new CdpConnection(webSocket);
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
  if (storage !== undefined) {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { if (location.protocol.startsWith("http")) localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(storage)}); } catch (e) {}`,
    });
  }
  result.cdp = cdp;
  return result;
}

/**
 * 用 CDP 打开一个页面：固定视口 1920×1080 → 导航 → 等看板就绪 → 读 DOM。
 * @returns {Promise<{dom: string, dataset: object|null, pageErrors: string[], timedOut: boolean, stderr: string}>}
 */
async function renderPage(url, { storage } = {}) {
  let browser = null;
  try {
    browser = await launchPage({ storage });
    const { cdp, pageErrors, deadline } = browser;
    if (!cdp) return { dom: "", dataset: null, pageErrors: [], timedOut: true, stderr: browser.stderr() };

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
      stderr: browser.stderr(),
    };
  } catch (error) {
    return { dom: "", dataset: null, pageErrors: [], timedOut: false, stderr: `${browser?.stderr() ?? ""}\n${error.message}` };
  } finally {
    await browser?.close();
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

  // 6. 一句话结论：分析页必须存在且非空；工具页不显示
  const insight = parseInsight(dom);
  if (page.tool) {
    if (!insight.hidden) fail("工具页不应显示一句话结论");
  } else {
    if (insight.hidden) fail("一句话结论被隐藏（#insight hidden）");
    if (insight.text.length < 5) fail(`一句话结论内容过短/为空：${JSON.stringify(insight.text)}`);
  }

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
    // 没有图表的页面（数据导入）不需要图表降级提示
    if (page.charts > 0 && !dom.includes("图表库未能从 CDN 加载")) {
      fail("ECharts 未加载，但页面没有图表降级提示（应提示 CDN 失败、表格仍可读）");
    }
  } else {
    fail(`无法判断 ECharts 状态（diagnostics.echarts=${JSON.stringify(diagnostics?.echarts)}）`);
  }

  // 9. 该页关键内容存在（表格文字 / 面板标题 / 渠道名等）；
  //    page.tokens 含演示数据专属数值，本机导入数据场景只校验 expect.tokens
  const pageTokens = scenario.expect?.source === "import" ? [] : page.tokens;
  for (const token of pageTokens) {
    if (!domText.includes(token)) fail(`页面内容缺少关键文本：${JSON.stringify(token)}`);
  }

  // 10. 当前层级导航高亮唯一且匹配
  const activeNav = countActiveNav(dom);
  if (activeNav !== 1) fail(`高亮导航数量 ${activeNav}，期望 1`);
  if (!new RegExp(`class="nav-tab[^"]*\\bactive\\b[^"]*"[^>]*data-route="${scenario.pageId}"`).test(dom)) {
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

  // 12. 数据来源 / 提示条 / 指标卡（本机数据注入场景）
  const expect = scenario.expect ?? {};
  if (expect.source && diagnostics?.source !== expect.source) {
    fail(`数据来源 data-source=${JSON.stringify(diagnostics?.source)}，期望 ${JSON.stringify(expect.source)}`);
  }
  if (expect.metric && !(cards[0]?.value ?? "").includes(expect.metric)) {
    fail(`首张指标卡=${JSON.stringify(cards[0]?.value)}，期望包含 ${JSON.stringify(expect.metric)}`);
  }
  const noticeTag = dom.match(/<div[^>]*id="notice-bar"[^>]*>/)?.[0] ?? "";
  const noticeHidden = /(^|\s)hidden(\s|=|>)/.test(noticeTag);
  const noticeText = stripTags(dom.match(/<span id="notice-text">([\s\S]*?)<\/span>/)?.[1] ?? "");
  if (expect.notice) {
    if (noticeHidden || !noticeText.includes(expect.notice)) fail(`缺少提示条：${JSON.stringify(expect.notice)}（实际 ${JSON.stringify(noticeText)}）`);
  } else if (!noticeHidden) {
    fail(`出现意外提示条：${JSON.stringify(noticeText)}`);
  }
  for (const token of expect.tokens ?? []) {
    if (!domText.includes(token)) fail(`页面内容缺少关键文本：${JSON.stringify(token)}`);
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
// 导入交互流程（CDP 驱动：下载模板 / 上传文件 / 确认 / 取消 / 恢复演示数据）
// ---------------------------------------------------------------------------


async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result?.value;
}

/** 轮询表达式直到为真值，返回该值；超时抛错。 */
async function waitFor(cdp, expression, label, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const value = await evaluate(cdp, expression);
      if (value) return value;
    } catch {
      /* 导航中 */
    }
    await sleep(100);
  }
  const snapshot = await evaluate(cdp, `JSON.stringify({ route: ${Q.route}, source: ${Q.source}, metric: ${Q.metric}, status: document.getElementById('diagnostics')?.dataset.status })`).catch(() => "?");
  throw new Error(`等待超时：${label}（当前 ${snapshot}）`);
}

// 每个表达式都加括号，便于用 && / .includes() 拼接时不受运算符优先级影响
const Q = {
  source: "(document.getElementById('diagnostics')?.dataset.source)",
  metric: "(document.querySelector('.metric-card .metric-value')?.textContent ?? '')",
  route: "(document.getElementById('diagnostics')?.dataset.route)",
  resultState: "(document.getElementById('import-result')?.dataset.state ?? '')",
  status: "(document.getElementById('import-status')?.textContent ?? '')",
  issues: "JSON.stringify([...document.querySelectorAll('.issue-item')].map((li) => li.textContent))",
  counts: "JSON.stringify([...document.querySelectorAll('[data-count]')].map((n) => n.textContent))",
};

/** 通过 CDP 给 #file-input 设置文件（会触发 change 事件）。 */
async function uploadFiles(cdp, files) {
  const { root } = await cdp.send("DOM.getDocument", { depth: 1 });
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#file-input" });
  if (!nodeId) throw new Error("找不到 #file-input");
  await cdp.send("DOM.setFileInputFiles", { nodeId, files });
}

async function openImportPage(cdp, baseUrl) {
  await cdp.send("DOM.enable");
  await cdp.send("Page.navigate", { url: `${baseUrl}/#/import` });
  await waitFor(cdp, `${Q.route} === '#/import' && !!document.getElementById('file-input')`, "导入页就绪");
}

/** 按 sheet 写出 CSV（可选修改），返回文件路径列表。 */
async function writeCsvSet(dir, prefix, mutate = () => {}) {
  const sheets = structuredClone(denormalize(input));
  mutate(sheets);
  const files = [];
  for (const [name, rows] of Object.entries(sheets)) {
    const file = path.join(dir, `${prefix}-${name}.csv`);
    await writeFile(file, toCSV(rows), "utf8");
    files.push(file);
  }
  return files;
}

const FLOWS = [
  {
    id: "template-roundtrip",
    label: "下载模板 → 原样上传 → 确认导入",
    needsXlsx: true,
    async run({ cdp, baseUrl, workDir, check }) {
      await openImportPage(cdp, baseUrl);
      const downloadDir = path.join(workDir, "download");
      await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
      await evaluate(cdp, "document.getElementById('btn-template').click()");
      const file = path.join(downloadDir, "收入分析数据模板.xlsx");
      const end = Date.now() + 10_000;
      let size = 0;
      while (Date.now() < end) {
        size = await readFile(file).then((b) => b.length).catch(() => 0);
        if (size > 1000) break;
        await sleep(100);
      }
      check(size > 1000, `模板未下载（${file}，${size} 字节）`);
      if (size <= 1000) return;
      await uploadFiles(cdp, [file]);
      await waitFor(cdp, `${Q.resultState} === 'valid' || ${Q.resultState} === 'invalid'`, "校验结果");
      const counts = JSON.parse(await evaluate(cdp, Q.counts));
      check(counts.join() === "错误 0,警告 0", `模板原样上传应零错误零警告，实际 ${counts.join()}；${await evaluate(cdp, Q.issues)}`);
      const sheetTitles = await evaluate(cdp, "[...document.querySelectorAll('.preview-title')].map((n) => n.firstChild.textContent.trim()).join()");
      check(sheetTitles === "渠道,门店,品类,门店客流", `预览 sheet=${sheetTitles}`);
      await evaluate(cdp, "document.getElementById('btn-confirm').click()");
      await waitFor(cdp, `${Q.route} === '#/channel' && ${Q.source} === 'import'`, "导入后跳转看板");
      const metric = await evaluate(cdp, Q.metric);
      check(metric.includes("1000.00"), `导入模板后本期总收入=${metric}，期望与演示数据一致 1000.00`);
      const label = await evaluate(cdp, "document.getElementById('period-label').textContent");
      check(label.includes("收入分析数据模板.xlsx") && label.includes("导入于"), `页头未显示文件名 / 导入时间：${label}`);
    },
  },
  {
    id: "e2e",
    label: "端到端：模板改 3 个数 → 看板 → 报告 PDF",
    needsXlsx: true,
    async run({ cdp, baseUrl, workDir, check }) {
      await openImportPage(cdp, baseUrl);
      const downloadDir = path.join(workDir, "download");
      await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
      await evaluate(cdp, "document.getElementById('btn-template').click()");
      const template = path.join(downloadDir, "收入分析数据模板.xlsx");
      let bytes = null;
      for (let i = 0; i < 100 && !(bytes?.length > 1000); i += 1) {
        bytes = await readFile(template).catch(() => null);
        await sleep(100);
      }
      check(bytes?.length > 1000, "模板未下载");
      if (!(bytes?.length > 1000)) return;

      // 像用户在 Excel 里一样改 3 个单元格（用页面里的 SheetJS 读写）：
      // 渠道 C2 美团大众本期 460 → 480；门店 E2 门店1 本期 69.1 → 79.1；品类 E2 肉类本期收入 546.07 → 556.07
      const edited = await evaluate(
        cdp,
        `(() => {
          const wb = XLSX.read(${JSON.stringify(bytes.toString("base64"))}, { type: "base64" });
          wb.Sheets["渠道"].C2 = { t: "n", v: 480 };
          wb.Sheets["门店"].E2 = { t: "n", v: 79.1 };
          wb.Sheets["品类"].E2 = { t: "n", v: 556.07 };
          return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
        })()`,
      );
      const editedFile = path.join(workDir, "九月数据-已修改.xlsx");
      await writeFile(editedFile, Buffer.from(edited, "base64"));
      await uploadFiles(cdp, [editedFile]);
      await waitFor(cdp, `${Q.resultState} === 'valid' || ${Q.resultState} === 'invalid'`, "校验结果");
      const counts = JSON.parse(await evaluate(cdp, Q.counts));
      check(counts.join() === "错误 0,警告 0", `修改后应零错误零警告（渠道 1020 vs 门店 1010.23 差 0.96% < 1%），实际 ${counts.join()}`);
      await evaluate(cdp, "document.getElementById('btn-confirm').click()");
      await waitFor(cdp, `${Q.route} === '#/channel' && ${Q.source} === 'import'`, "导入后跳转看板");

      // 手算期望：本期 1000 + 20 = 1020.00；同比 240.44 + 20 = +260.44；增长率 260.44 / 759.56 = +34.29%；
      // 同店本期 857.23 + 10 = 867.23，同店增长 (867.23 − 759.95) / 759.95 = +14.12%；新店占比 143 / 1010.23 = 14.16%
      const expected = ["1020.00万元", "+260.44万元", "+34.29%", "+14.12%", "14.16%"];
      const cards = JSON.parse(await evaluate(cdp, "JSON.stringify([...document.querySelectorAll('.metric-card .metric-value')].map((n) => n.textContent.replace(/\\s+/g, '')))"));
      check(JSON.stringify(cards) === JSON.stringify(expected), `看板指标卡=${cards.join(" / ")}，手算期望 ${expected.join(" / ")}`);

      await evaluate(cdp, "location.hash = '#/category'");
      await waitFor(cdp, `${Q.route} === '#/category'`, "进入品类页");
      const meat = await evaluate(cdp, "[...document.querySelectorAll('tbody tr')].find((tr) => tr.firstElementChild.textContent === '肉类')?.lastElementChild.textContent");
      check(meat === "+168.07", `肉类全店收入差=${meat}，手算期望 556.07 − 388 = +168.07`);

      await evaluate(cdp, "location.hash = '#/report'");
      await waitFor(cdp, `${Q.route} === '#/report'`, "进入报告");
      const reportCards = JSON.parse(await evaluate(cdp, "JSON.stringify([...document.querySelectorAll('.report-metric-value')].map((n) => n.textContent.replace(/\\s+/g, '')))"));
      check(JSON.stringify(reportCards) === JSON.stringify(expected), `报告指标=${reportCards.join(" / ")}，应与看板一致`);
      const source = await evaluate(cdp, "document.getElementById('report-source').textContent");
      check(source === "导入数据：九月数据-已修改.xlsx", `报告封面数据来源=${source}`);

      await evaluate(cdp, "window.dispatchEvent(new Event('beforeprint'))");
      const pdf = await cdp.send("Page.printToPDF", { preferCSSPageSize: true, printBackground: true });
      const pdfBytes = Buffer.from(pdf.data, "base64");
      const pages = (pdfBytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      check(pages === 7, `报告 PDF 页数=${pages}，期望 7（封面总览 + 5 章 + 结论汇总，各章新起一页）`);
      const box = pdfBytes.toString("latin1").match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/);
      check(box && Math.abs(Number(box[1]) - 595) < 2 && Math.abs(Number(box[2]) - 842) < 2, `PDF 纸张不是 A4 纵向：${box?.slice(1).join("×")}`);
      await evaluate(cdp, "window.dispatchEvent(new Event('afterprint'))");
    },
  },
  {
    id: "invalid-csv",
    label: "上传错误 CSV → 错误清单 / 禁用导入",
    async run({ cdp, baseUrl, workDir, check }) {
      await openImportPage(cdp, baseUrl);
      const files = await writeCsvSet(workDir, "bad", (sheets) => {
        sheets["渠道"][4][2] = "四百";
        sheets["门店客流"][3][0] = "门店99";
      });
      await uploadFiles(cdp, files);
      await waitFor(cdp, `${Q.resultState} === 'invalid'`, "校验未通过");
      const issues = JSON.parse(await evaluate(cdp, Q.issues));
      check(issues.includes("渠道 · 第 5 行 · 本期收入：「四百」不是数字"), `错误清单缺少数值错误：${issues.join(" | ")}`);
      check(issues.some((text) => text.startsWith("门店客流 · 第 4 行 · 门店") && text.includes("门店99")), `错误清单缺少跨表错误：${issues.join(" | ")}`);
      check(await evaluate(cdp, "document.getElementById('btn-confirm').disabled"), "存在错误时「确认导入」应禁用");
      check((await evaluate(cdp, Q.source)) === "demo", "校验失败不应改变看板数据");
    },
  },
  {
    id: "modified-import-reset",
    label: "修改数值导入 → 看板变化 → 恢复演示数据",
    async run({ cdp, baseUrl, workDir, check }) {
      await openImportPage(cdp, baseUrl);
      const files = await writeCsvSet(workDir, "edit", (sheets) => {
        sheets["渠道"][1][2] = "500"; // 美团大众本期 460 → 500
        sheets["渠道"][2][1] = "0"; // 扫码支付同期为 0 → 警告
      });
      await uploadFiles(cdp, files);
      await waitFor(cdp, `${Q.resultState} === 'valid'`, "校验通过");
      const counts = JSON.parse(await evaluate(cdp, Q.counts));
      check(counts[0] === "错误 0" && counts[1] !== "警告 0", `期望 0 错误、有警告，实际 ${counts.join()}`);
      await evaluate(cdp, "document.getElementById('btn-confirm').click()");
      await waitFor(cdp, `${Q.route} === '#/channel' && ${Q.source} === 'import'`, "导入后跳转看板");
      const metric = await evaluate(cdp, Q.metric);
      check(metric.includes("1040.00"), `导入后本期总收入=${metric}，期望 1040.00`);
      const insight = await evaluate(cdp, "document.getElementById('insight-text').textContent");
      // 扫码支付同期改为 0 后本期 316 全部计为增量，成为正向贡献最大的渠道
      check(insight.includes("扫码支付") && insight.includes("+316.00"), `结论未随数据变化：${insight}`);
      const growth = await evaluate(cdp, "[...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('扫码支付'))?.lastElementChild.textContent");
      check(growth === "—", `同期为 0 的增减率应显示 —，实际 ${growth}`);

      // 刷新后仍为导入数据
      await cdp.send("Page.reload");
      await waitFor(cdp, `${Q.source} === 'import' && ${Q.metric}.includes('1040.00')`, "刷新后保留导入数据");

      await evaluate(cdp, "document.getElementById('source-reset').click()");
      await waitFor(cdp, `${Q.source} === 'demo'`, "恢复演示数据");
      check((await evaluate(cdp, Q.metric)).includes("1000.00"), "恢复后本期总收入应为 1000.00");
      check((await evaluate(cdp, "document.getElementById('source-badge').textContent")) === "演示数据", "恢复后徽章应为「演示数据」");
      check((await evaluate(cdp, `localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`)) === null, "恢复后本机数据应被清除");
    },
  },
  {
    id: "derived-import",
    label: "同店销量留空导入 → 折算标注",
    async run({ cdp, baseUrl, workDir, check }) {
      await openImportPage(cdp, baseUrl);
      const files = await writeCsvSet(workDir, "derive", (sheets) => {
        for (const row of sheets["品类"].slice(1)) row[5] = "";
      });
      await uploadFiles(cdp, files);
      await waitFor(cdp, `${Q.resultState} === 'valid'`, "校验通过");
      const tags = await evaluate(cdp, "document.querySelectorAll('.derived-tag').length");
      check(tags > 0, "预览中未标注折算字段");
      await evaluate(cdp, "document.getElementById('btn-confirm').click()");
      await waitFor(cdp, `${Q.source} === 'import'`, "导入完成");
      const footer = await evaluate(cdp, "document.getElementById('footer-derived').hidden ? '' : document.getElementById('footer-derived').textContent");
      check(footer.includes("折算"), `页脚未注明折算口径：${JSON.stringify(footer)}`);
      await evaluate(cdp, "location.hash = '#/report'");
      await waitFor(cdp, `${Q.route} === '#/report'`, "进入报告");
      const notes = await evaluate(cdp, "[...document.querySelectorAll('[data-chapter=category] .report-note, [data-chapter=traffic] .report-note')].map((n) => n.textContent).join(' | ')");
      check((notes.match(/同店销量由系统折算/g) ?? []).length === 2, `报告品类 / 客流章节缺少折算注释：${notes}`);
    },
  },
  {
    id: "cancel-and-unsupported",
    label: "取消导入 / 不支持的文件格式",
    async run({ cdp, baseUrl, workDir, check }) {
      await openImportPage(cdp, baseUrl);
      await uploadFiles(cdp, await writeCsvSet(workDir, "cancel"));
      await waitFor(cdp, `${Q.resultState} === 'valid'`, "校验通过");
      await evaluate(cdp, "document.getElementById('btn-cancel').click()");
      check((await evaluate(cdp, Q.resultState)) === "cancelled", "取消后应显示已取消");
      check((await evaluate(cdp, Q.source)) === "demo", "取消后看板数据应保持不变");

      const pdf = path.join(workDir, "report.pdf");
      await writeFile(pdf, "%PDF-1.4");
      await uploadFiles(cdp, [pdf]);
      await waitFor(cdp, `${Q.resultState} === 'rejected'`, "拒绝不支持格式");
      check((await evaluate(cdp, Q.status)) === "仅支持 xlsx / csv 模板文件", `提示文字=${await evaluate(cdp, Q.status)}`);
      check((await evaluate(cdp, Q.source)) === "demo", "上传失败后看板数据应保持不变");
    },
  },
];

async function runFlow(flow, baseUrl) {
  const failures = [];
  const check = (ok, message) => {
    if (!ok) failures.push(message);
  };
  const workDir = await mkdtemp(path.join(os.tmpdir(), "revenue-smoke-flow-"));
  let browser = null;
  try {
    browser = await launchPage();
    if (!browser.cdp) {
      failures.push(`Chrome 启动失败：${browser.stderr().slice(0, 300)}`);
      return failures;
    }
    if (flow.needsXlsx) {
      await browser.cdp.send("Page.navigate", { url: `${baseUrl}/#/import` });
      await waitFor(browser.cdp, `${Q.route} === '#/import'`, "导入页就绪");
      const ready = await evaluate(browser.cdp, "Boolean(window.XLSX)");
      if (!ready) {
        // SheetJS CDN 不可达：断言降级为 CSV 下载入口
        const fallback = await evaluate(browser.cdp, "!document.getElementById('csv-fallback').hidden && document.querySelectorAll('[data-csv]').length");
        check(fallback === 5, "SheetJS 未加载时应显示 5 个 CSV 模板下载按钮");
        return failures.length ? failures : ["SKIP"];
      }
    }
    await flow.run({ cdp: browser.cdp, baseUrl, workDir, check });
    if (browser.pageErrors.length) failures.push(`页面出现未捕获脚本异常：${browser.pageErrors.join(" | ")}`);
    const errorBar = await evaluate(browser.cdp, "document.getElementById('error-bar').hidden");
    if (!errorBar) failures.push(`页面出现错误条：${await evaluate(browser.cdp, "document.getElementById('error-bar').textContent")}`);
  } catch (error) {
    failures.push(error.message);
  } finally {
    await browser?.close();
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
  return failures;
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
  console.log(`- 场景：${SCENARIOS.length} 个页面场景（5 个分析页 + 无 hash + 非法 hash + 2 个工具页 + 本机数据注入）+ 导入交互流程`);
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
  const flowResults = [];
  let echartsMode = "unknown";

  try {
    for (const scenario of SCENARIOS) {
      const page = PAGES[scenario.pageId];
      const url = `${baseUrl}${scenario.path}`;
      process.stdout.write(`→ 冒烟：${scenario.label}（${url}）… `);
      const meta = await renderPage(url, { storage: scenario.storage });
      const { failures, info } = checkScenario(scenario, page, meta);
      if (info.echarts && info.echarts !== "unknown") echartsMode = info.echarts;
      results.push({ ...scenario, page, expectedRoute: page.hash, failures, info });
      console.log(failures.length === 0 ? "PASS" : `FAIL（${failures.length}）`);
    }

    console.log("");
    for (const flow of FLOWS) {
      process.stdout.write(`→ 流程：${flow.label} … `);
      const failures = await runFlow(flow, baseUrl);
      const skipped = failures.length === 1 && failures[0] === "SKIP";
      flowResults.push({ ...flow, failures: skipped ? [] : failures, skipped });
      console.log(skipped ? "SKIP（SheetJS 未加载，已验证 CSV 降级入口）" : failures.length === 0 ? "PASS" : `FAIL（${failures.length}）`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("");
  console.log("冒烟结果：");
  console.log("");

  const headers = ["场景", "期望路由", "实际路由", "表格行", "图表", "结论"];
  const widths = [26, 14, 14, 11, 8, 6];
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
  const failedFlows = flowResults.filter((row) => row.failures.length > 0);
  for (const row of failedFlows) {
    console.log("");
    console.log(`✖ 流程「${row.label}」失败原因：`);
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
    `汇总：${SCENARIOS.length} 个场景，通过 ${results.length - failed.length}，失败 ${failed.length}；` +
      `${FLOWS.length} 个导入流程，通过 ${flowResults.filter((r) => !r.skipped && r.failures.length === 0).length}，` +
      `跳过 ${flowResults.filter((r) => r.skipped).length}，失败 ${failedFlows.length}。`,
  );

  if (failed.length > 0 || failedFlows.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("");
  console.error("✖ 冒烟脚本自身异常：", error);
  process.exitCode = 1;
});
