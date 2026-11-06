/**
 * 看板入口：加载数据 → 调用引擎 → 渲染页面外壳与 hash 路由。
 *
 * 冷启动顺序：
 * 1. 安装全局错误兜底（window.onerror / unhandledrejection）；
 * 2. 通过 HTTP 读取演示数据 data/revenue_2025-09.json（file:// 直开会失败，给可读提示而不是白屏）；
 * 3. 读取当前数据集（本机导入数据优先，校验失败回退演示数据，见 dataset.js）；
 * 4. 调用引擎 analyze(data)，把结果交给页面结构（来源、指标卡）与路由渲染；
 * 5. 导入 / 恢复演示数据时重建 ctx 并重新渲染，不整页刷新；
 * 6. 把启动状态写入 #diagnostics，供冒烟测试读取。
 */

import { analyze } from "../engine/index.js";
import { echartsReady } from "./charts.js";
import { loadCurrentDataset, resetToDemo, saveImported } from "./dataset.js";
import { renderDatasetSource, renderMetricCards, setDiagValue, showError, showFatal, showNotice } from "./layout.js";
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
    const demoData = await loadRevenueData();
    let ctx = null;
    let router = null;

    /** 用数据集重建 ctx（每次 analyze 一次，看板与报告共用同一份结果）。 */
    const applyDataset = (dataset) => {
      ctx = {
        data: dataset.data,
        result: analyze(dataset.data),
        dataset,
        demoData,
        actions,
      };
      renderDatasetSource(dataset, { onReset: actions.resetToDemo });
      renderMetricCards(ctx);
      showNotice(dataset.notice);
    };

    const actions = {
      /** 导入页确认导入：保存到本机 → 重新计算 → 跳到第 1 层。 */
      applyImport({ fileName, data, meta }) {
        applyDataset(saveImported({ fileName, data, meta }));
        if (window.location.hash === "#/channel") router.refresh();
        else window.location.hash = "#/channel";
      },
      /** 清除本机导入数据，回到演示数据。 */
      resetToDemo() {
        applyDataset(resetToDemo(demoData));
        router.refresh();
      },
    };

    applyDataset(loadCurrentDataset(demoData));
    router = createRouter({ getCtx: () => ctx, mount: document.getElementById("page") });
    router.start();
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
