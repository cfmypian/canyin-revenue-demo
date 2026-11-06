/**
 * Hash 路由：
 * - 五层下钻 `#/channel`、`#/store-mix`、`#/store-rank`、`#/category`、`#/traffic`；
 * - 工具页 `#/import`（数据导入）、`#/report`（分析报告），不参与「继续下钻」链路。
 *
 * - 默认 `#/channel`（第 1 层渠道结构页），非法 hash 自动回落到第 1 层；
 * - 页签直接跳转、页面底部「继续下钻」按钮都通过 hash 切换；
 * - 切换路由时销毁旧图表实例并调用旧页面的 destroy()，避免图表与事件监听泄漏；
 * - 当前数据集切换后由 refresh() 重新渲染当前页（ctx 通过 getCtx() 每次实时读取）。
 */

import { disposeCharts, resizeCharts } from "./charts.js";
import {
  setActiveNav,
  setDiagValue,
  setInsight,
  setPageFoot,
  setPageHeader,
  showError,
} from "./layout.js";
import { LEVELS, TOOLS } from "./levels.js";
import { categoryPage } from "./pages/category.js";
import { channelPage } from "./pages/channel.js";
import { importPage } from "./pages/import.js";
import { reportPage } from "./pages/report.js";
import { storeMixPage } from "./pages/storeMix.js";
import { storeRankPage } from "./pages/storeRank.js";
import { trafficPage } from "./pages/traffic.js";

const PAGES = {
  channel: channelPage,
  "store-mix": storeMixPage,
  "store-rank": storeRankPage,
  category: categoryPage,
  traffic: trafficPage,
  import: importPage,
  report: reportPage,
};

/** 五层下钻路由表，顺序即下钻顺序。 */
export const ROUTES = LEVELS.map((level) => ({ ...level, page: PAGES[level.id] }));

/** 工具页路由。 */
export const TOOL_ROUTES = TOOLS.map((tool) => ({ ...tool, page: PAGES[tool.id] }));

ROUTES.forEach((route, index) => {
  const next = ROUTES[index + 1];
  route.next = next ? { id: next.id, hash: next.hash, label: next.label } : null;
});

const ALL_ROUTES = [...ROUTES, ...TOOL_ROUTES];

/**
 * 解析当前 hash；非法或为空时回落到第 1 层（用 replaceState 避免多触发一次渲染）。
 * @returns {object} 命中的路由
 */
function resolveRoute() {
  const currentHash = window.location.hash;
  const matched = ALL_ROUTES.find((route) => route.hash === currentHash);
  if (matched) return matched;
  const fallback = ROUTES[0];
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${fallback.hash}`);
  return fallback;
}

/** 测量页面尺寸写入自检节点（冒烟测试可验证无横向滚动、面板无内部截断）。 */
function measurePage() {
  const html = document.documentElement;
  // 表格容器内部是否被截断（投影时不希望表格出现纵向滚动条）
  const tableOverflows = Array.from(document.querySelectorAll(".table-wrap")).map(
    (element) => element.scrollHeight - element.clientHeight,
  );
  const overflowingTables = tableOverflows.filter((delta) => delta > 2).length;
  setDiagValue("scrollWidth", html.scrollWidth);
  setDiagValue("scrollHeight", html.scrollHeight);
  setDiagValue("viewport", `${window.innerWidth}x${window.innerHeight}`);
  setDiagValue("charts", document.querySelectorAll("canvas").length);
  setDiagValue("tableOverflow", overflowingTables);
  setDiagValue("tableOverflowPx", Math.max(0, ...tableOverflows));
}

/**
 * 创建路由控制器。
 * @param {{ getCtx: () => object, mount: HTMLElement }} options
 */
export function createRouter({ getCtx, mount }) {
  let current = null;

  function render(route) {
    try {
      current?.page.destroy?.();
    } catch (error) {
      console.error(error);
    }
    disposeCharts();

    const ctx = getCtx();
    document.body.classList.toggle("mode-tool", Boolean(route.tool));
    document.body.dataset.route = route.id;
    setActiveNav(route.id);
    setPageHeader(route, ROUTES);
    setInsight(route.tool ? "" : ctx.result.insights[route.insightKey]);
    setPageFoot(route, ROUTES);

    mount.innerHTML = "";
    mount.dataset.page = route.id;
    current = route;

    try {
      route.page.render(mount, ctx);
    } catch (error) {
      showError(`页面渲染失败（${route.label}）：${error?.message ?? error}`);
      console.error(error);
    }

    document.title = `${route.title} · 餐饮收入分析看板`;
    setDiagValue("route", route.hash);
    setDiagValue("status", "ready");
    window.requestAnimationFrame(measurePage);
  }

  function onHashChange() {
    render(resolveRoute());
  }

  function onResize() {
    resizeCharts();
    measurePage();
  }

  return {
    start() {
      render(resolveRoute());
      window.addEventListener("hashchange", onHashChange);
      window.addEventListener("resize", onResize);
    },
    /** 重新渲染当前页（数据集切换后调用）。 */
    refresh() {
      render(resolveRoute());
    },
  };
}
