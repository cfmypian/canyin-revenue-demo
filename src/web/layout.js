/**
 * 页面外壳渲染：首屏指标卡、一句话结论、页面标题、底部下钻按钮、全局错误条。
 *
 * 只负责把数据写进 index.html 里预留好的骨架节点，具体页面内容由 pages/ 渲染。
 */

import { importedAtLabel, sourceLabel } from "./dataset.js";
import { htmlEsc } from "./format.js";
import { buildMetrics } from "./metrics.js";

function diagnostics() {
  return document.getElementById("diagnostics");
}

/** 写自检信息（冒烟测试可读 data-* 属性）。 */
export function setDiagValue(key, value) {
  const element = diagnostics();
  if (element) element.dataset[key] = String(value);
}

/**
 * 首屏 5 张指标卡：
 * 本期总收入 / 同比差额 / 同比增长率 / 同店增长率 / 新店收入占比。
 * 口径与分析报告共用 buildMetrics，保证两处数字一致。
 * @param {{ data: object, result: object }} context
 */
export function renderMetricCards(context) {
  const container = document.getElementById("metric-cards");
  if (!container) return;

  container.innerHTML = buildMetrics(context)
    .map(
      (card) => `<article class="metric-card ${card.tone}">
        <p class="metric-label">${htmlEsc(card.label)}</p>
        <p class="metric-value ${card.tone}">${card.display}${card.unit ? `<span class="metric-unit">${htmlEsc(card.unit)}</span>` : ""}</p>
        <p class="metric-sub">${htmlEsc(card.sub)}</p>
      </article>`,
    )
    .join("");
}

/**
 * 顶栏数据来源 + 页脚口径说明（随当前数据集变化）。
 * @param {{ data: object, source: object, meta: object }} dataset
 * @param {{ onReset: () => void }} handlers
 */
export function renderDatasetSource(dataset, { onReset }) {
  const isImport = dataset?.source?.type === "import";
  const badge = document.getElementById("source-badge");
  if (badge) {
    badge.textContent = isImport ? "导入数据" : "演示数据";
    badge.className = `source-badge ${isImport ? "is-import" : "is-demo"}`;
  }
  const reset = document.getElementById("source-reset");
  if (reset) {
    reset.hidden = !isImport;
    reset.onclick = onReset;
  }

  const label = document.getElementById("period-label");
  if (label) {
    const base = dataset?.data?.period?.base ?? "同期";
    const current = dataset?.data?.period?.current ?? "本期";
    const parts = [`${base} 同期 → ${current} 本期`, `数据：${sourceLabel(dataset?.source)}`];
    const at = importedAtLabel(dataset?.source);
    if (at) parts.push(`导入于 ${at}`);
    parts.push("金额单位：万元");
    label.textContent = parts.join(" · ");
    label.title = label.textContent;
  }

  const footerData = document.getElementById("footer-data");
  if (footerData) {
    footerData.textContent = isImport ? "用户导入数据，仅保存在本机浏览器" : "演示数据，非真实经营数据";
  }
  const footerSource = document.getElementById("footer-source");
  if (footerSource) {
    footerSource.textContent = `数据来源：${isImport ? dataset.source.fileName : "data/revenue_2025-09.json"} · 计算引擎 src/engine/`;
  }
  const footerDerived = document.getElementById("footer-derived");
  if (footerDerived) {
    const derived = derivedNote(dataset?.meta);
    footerDerived.textContent = derived;
    footerDerived.hidden = !derived;
  }
  setDiagValue("source", isImport ? "import" : "demo");
}

/** 系统折算字段的说明文字；没有折算时返回空字符串。 */
export function derivedNote(meta) {
  const item = (meta?.derived ?? []).find((entry) => entry.field === "same_store_current_qty");
  if (!item) return "";
  return `品类本期同店销量未填写，已按同店收入占比折算（${item.items.length} 个品类，演示口径）`;
}

/**
 * 信息提示条（非错误）：数据集回退、保存失败等。
 * @param {string|null} message 为空时隐藏
 */
export function showNotice(message) {
  const bar = document.getElementById("notice-bar");
  const text = document.getElementById("notice-text");
  if (!bar || !text) return;
  if (!message) {
    bar.hidden = true;
    return;
  }
  text.textContent = message;
  bar.hidden = false;
  const close = document.getElementById("notice-close");
  if (close) close.onclick = () => (bar.hidden = true);
}

/** 每页一句话结论（内容直接取引擎 insights，不在页面里再算一遍）。 */
export function setInsight(text) {
  const banner = document.getElementById("insight");
  const target = document.getElementById("insight-text");
  if (!banner || !target) return;
  if (!text) {
    banner.hidden = true;
    return;
  }
  target.textContent = text;
  banner.hidden = false;
}

/** 高亮当前层级导航页签。 */
export function setActiveNav(routeId) {
  const tabs = document.querySelectorAll(".nav-tab");
  for (const tab of tabs) {
    const isActive = tab.dataset.route === routeId;
    tab.classList.toggle("active", isActive);
    if (isActive) {
      tab.setAttribute("aria-current", "page");
    } else {
      tab.removeAttribute("aria-current");
    }
  }
}

/** 页面标题区：第 N 层 / 共 N 层 + 页面标题 + 副标题。 */
export function setPageHeader(route, routes) {
  const container = document.getElementById("page-head");
  if (!container) return;
  const chip = route.tool ? "工具" : `第 ${route.level} 层 / 共 ${routes.length} 层`;
  container.innerHTML = `<div class="page-title-wrap">
      <span class="level-chip${route.tool ? " level-chip--tool" : ""}">${chip}</span>
      <h1 class="page-title">${htmlEsc(route.title)}</h1>
      <p class="page-sub">${htmlEsc(route.sub)}</p>
    </div>`;
}

/** 页面底部：当前层级 + “继续下钻”按钮（最后一层给回顾入口）。 */
export function setPageFoot(route, routes) {
  const container = document.getElementById("page-foot");
  if (!container) return;
  if (route.tool) {
    container.innerHTML = `<span class="foot-level">${htmlEsc(route.label)} · 不属于五层下钻</span>
      <a class="foot-next" href="${routes[0].hash}">进入看板：第 1 层 · ${htmlEsc(routes[0].label)} →</a>`;
    return;
  }
  if (route.next) {
    container.innerHTML = `<span class="foot-level">当前：第 ${route.level} 层 / 共 ${routes.length} 层 · ${htmlEsc(route.label)}</span>
      <a class="foot-next" href="${route.next.hash}" data-next-route="${route.next.id}">继续下钻：${htmlEsc(route.next.label)} →</a>`;
  } else {
    container.innerHTML = `<span class="foot-level">当前：第 ${route.level} 层 / 共 ${routes.length} 层 · ${htmlEsc(route.label)}（最后一层）</span>
      <span class="foot-last">已到最后一层，<a href="${routes[0].hash}">回到第 1 层 · 渠道结构</a></span>`;
  }
}

let errorCount = 0;

/** 顶部错误条：window.onerror / unhandledrejection / 页面渲染异常时显示。 */
export function showError(message) {
  errorCount += 1;
  const bar = document.getElementById("error-bar");
  if (!bar) return;
  bar.hidden = false;
  if (!bar.dataset.ready) {
    bar.innerHTML = '<p class="error-title">页面出现异常（下方表格若已渲染，数据仍可对照查看）：</p>';
    bar.dataset.ready = "1";
  }
  const line = document.createElement("p");
  line.className = "error-line";
  line.textContent = `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${String(message)}`;
  bar.appendChild(line);
  setDiagValue("errors", errorCount);
  setDiagValue("status", "error");
}

/**
 * 启动失败提示（不白屏）：file:// 直开、数据加载失败时展示。
 * @param {{ title: string, body: string, detail?: string }} options
 */
export function showFatal({ title, body, detail }) {
  const overlay = document.getElementById("boot-fatal");
  const titleElement = document.getElementById("boot-fatal-title");
  const bodyElement = document.getElementById("boot-fatal-body");
  if (!overlay || !titleElement || !bodyElement) return;
  titleElement.textContent = title;
  bodyElement.innerHTML = `${body}${detail ? `<p class="boot-fatal-detail">错误详情：${htmlEsc(detail)}</p>` : ""}`;
  overlay.hidden = false;
  setDiagValue("status", "fatal");
}
