/**
 * 页面外壳渲染：首屏指标卡、一句话结论、页面标题、底部下钻按钮、全局错误条。
 *
 * 只负责把数据写进 index.html 里预留好的骨架节点，具体页面内容由 pages/ 渲染。
 */

import { fmtPct, fmtSignedPct, fmtSignedWan, fmtWan, htmlEsc, toneOf } from "./format.js";

function diagnostics() {
  return document.getElementById("diagnostics");
}

/** 写自检信息（冒烟测试可读 data-* 属性）。 */
export function setDiagValue(key, value) {
  const element = diagnostics();
  if (element) element.dataset[key] = String(value);
}

/** 顶栏副标题：展示对比期间与单位约定。 */
export function setPeriodLabel(data) {
  const element = document.getElementById("period-label");
  if (!element) return;
  const base = data?.period?.base ?? "同期";
  const current = data?.period?.current ?? "本期";
  element.textContent = `${base} 同期 → ${current} 本期 · 五层下钻 · 金额单位：万元`;
}

/**
 * 首屏 5 张指标卡：
 * 本期总收入 / 同比差额 / 同比增长率 / 同店增长率 / 新店收入占比。
 * @param {{ data: object, result: object }} context
 */
export function renderMetricCards({ data, result }) {
  const container = document.getElementById("metric-cards");
  if (!container) return;

  const { channel, store_mix: storeMix } = result;
  const share = storeMix.same_store_ratio;
  const newStoreShare = share === null || share === undefined ? null : 1 - share;
  const currentPeriod = data?.period?.current ?? "本期";

  const cards = [
    {
      label: "本期总收入",
      value: fmtWan(channel.current_total),
      unit: "万元",
      sub: `${currentPeriod} · 渠道合计口径`,
      tone: "accent",
    },
    {
      label: "同比差额",
      value: fmtSignedWan(channel.diff),
      unit: "万元",
      sub: `同期 ${fmtWan(channel.base_total)} 万元`,
      tone: toneOf(channel.diff),
    },
    {
      label: "同比增长率",
      value: fmtSignedPct(channel.growth_rate),
      unit: "",
      sub: "渠道合计口径",
      tone: toneOf(channel.growth_rate),
    },
    {
      label: "同店增长率",
      value: fmtSignedPct(storeMix.same_store_growth),
      unit: "",
      sub: `同店收入 ${fmtWan(storeMix.same_store_current)} 万元`,
      tone: toneOf(storeMix.same_store_growth),
    },
    {
      label: "新店收入占比",
      value: newStoreShare === null ? "—" : fmtPct(newStoreShare),
      unit: "",
      sub: `新店收入 ${fmtWan(storeMix.new_store_current)} 万元`,
      tone: "flat",
    },
  ];

  container.innerHTML = cards
    .map(
      (card) => `<article class="metric-card ${card.tone}">
        <p class="metric-label">${htmlEsc(card.label)}</p>
        <p class="metric-value ${card.tone}">${card.value}${card.unit ? `<span class="metric-unit">${htmlEsc(card.unit)}</span>` : ""}</p>
        <p class="metric-sub">${htmlEsc(card.sub)}</p>
      </article>`,
    )
    .join("");
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
  container.innerHTML = `<div class="page-title-wrap">
      <span class="level-chip">第 ${route.level} 层 / 共 ${routes.length} 层</span>
      <h1 class="page-title">${htmlEsc(route.title)}</h1>
      <p class="page-sub">${htmlEsc(route.sub)}</p>
    </div>`;
}

/** 页面底部：当前层级 + “继续下钻”按钮（最后一层给回顾入口）。 */
export function setPageFoot(route, routes) {
  const container = document.getElementById("page-foot");
  if (!container) return;
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
