/**
 * 看板入口：加载数据 → 调用引擎 → 渲染页面外壳与 hash 路由。
 *
 * 冷启动顺序：
 * 1. 安装全局错误兜底（window.onerror / unhandledrejection）；
 * 2. 通过 HTTP 读取 data/revenue_2025-09.json（file:// 直开会失败，给可读提示而不是白屏）；
 * 3. 调用引擎 analyze(data)，把结果交给页面结构（标题、指标卡）与路由渲染；
 * 4. 把启动状态写入 #diagnostics，供冒烟测试读取。
 */

import { analyze } from "../engine/index.js";
import { echartsReady } from "./charts.js";
import { renderMetricCards, setDiagValue, setPeriodLabel, showError, showFatal } from "./layout.js";
import { createRouter } from "./router.js";

/** 全局错误兜底：任何脚本错误都在页面顶部显示可读错误条。 */
function installGlobalErrorHandlers() {
  window.addEventListener("error", (event) => {
    const message = event?.error?.message || event?.message || "未知脚本错误";
    showError(message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const message = reason?.message || String(reason ?? "未知异步错误");
    showError(message);
  });
}

/** 双击 HTML 直接打开（file://）时 fetch 会被浏览器拦截，给启动指引。 */
function showFileProtocolHelp() {
  showFatal({
    title: "请用本地服务器打开看板",
    body: `<p>当前是用 <code>file://</code> 直接打开 <code>index.html</code>，浏览器会拦截数据读取，页面无法渲染。</p>
      <p>请在项目根目录执行 <code>npm start</code>（或 <code>python3 -m http.server 8080</code>），然后访问
      <a href="http://localhost:8080">http://localhost:8080</a>。</p>`,
    detail: "看板是纯静态页面，必须通过 HTTP 服务打开，不能双击 HTML 文件。",
  });
}

/** 读取演示数据 JSON。 */
async function loadRevenueData() {
  let response;
  try {
    response = await fetch("./data/revenue_2025-09.json", { cache: "no-store" });
  } catch (error) {
    throw new Error(`无法读取数据文件：${error?.message ?? error}`);
  }
  if (!response.ok) {
    throw new Error(`数据文件读取失败：HTTP ${response.status}`);
  }
  return response.json();
}

async function boot() {
  installGlobalErrorHandlers();
  setDiagValue("status", "boot");
  setDiagValue("echarts", echartsReady() ? "ready" : "missing");

  if (window.location.protocol === "file:") {
    showFileProtocolHelp();
    return;
  }

  try {
    const data = await loadRevenueData();
    const result = analyze(data);
    const ctx = { data, result };

    setPeriodLabel(data);
    renderMetricCards(ctx);
    createRouter({ ctx, mount: document.getElementById("page") }).start();
    setDiagValue("status", "ready");
  } catch (error) {
    showFatal({
      title: "数据加载失败",
      body: `<p>看板需要读取 <code>./data/revenue_2025-09.json</code>，当前没有成功加载。</p>
        <p>请在项目根目录执行 <code>npm start</code> 后重新打开；若仍失败，请确认数据文件存在。</p>`,
      detail: error?.message ?? String(error),
    });
    console.error(error);
  }
}

boot();
