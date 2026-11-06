/**
 * Hash 路由：`#/channel`、`#/store-mix`、`#/store-rank`、`#/category`、`#/traffic`。
 *
 * - 默认 `#/channel`（第 1 层渠道结构页），非法 hash 自动回落到第 1 层；
 * - 页签直接跳转、页面底部「继续下钻」按钮都通过 hash 切换；
 * - 切换路由时销毁旧图表实例，避免图表叠加泄漏。
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
import { categoryPage } from "./pages/category.js";
import { channelPage } from "./pages/channel.js";
import { storeMixPage } from "./pages/storeMix.js";
import { storeRankPage } from "./pages/storeRank.js";
import { trafficPage } from "./pages/traffic.js";

/** 五层下钻路由表，顺序即下钻顺序。 */
export const ROUTES = [
  {
    id: "channel",
    hash: "#/channel",
    level: 1,
    label: "渠道结构",
    title: "渠道收入结构",
    sub: "收入从哪些渠道来、各渠道同比增减与占比",
    insightKey: "channel",
    page: channelPage,
  },
  {
    id: "store-mix",
    hash: "#/store-mix",
    level: 2,
    label: "同店 / 新店",
    title: "同店 / 新店结构与同店渠道拆解",
    sub: "增长来自老店还是新店，同店各渠道分别贡献多少",
    insightKey: "store_mix",
    page: storeMixPage,
  },
  {
    id: "store-rank",
    hash: "#/store-rank",
    level: 3,
    label: "门店排名",
    title: "门店收入 / 增长额 / 增长率排名",
    sub: "同店门店三种排名，新店不参与增长排名",
    insightKey: "store_rank",
    page: storeRankPage,
  },
  {
    id: "category",
    hash: "#/category",
    level: 4,
    label: "品类量价",
    title: "品类量价因素分析",
    sub: "收入变动拆成销量影响与单价影响，可切换全店 / 同店口径",
    insightKey: "category_qty_price",
    page: categoryPage,
  },
  {
    id: "traffic",
    hash: "#/traffic",
    level: 5,
    label: "客流客单",
    title: "客流 × 人均销量 × 单价三因素",
    sub: "同店品类三因素 + 门店客流客单两因素",
    insightKey: "traffic",
    page: trafficPage,
  },
];

ROUTES.forEach((route, index) => {
  const next = ROUTES[index + 1];
  route.next = next ? { id: next.id, hash: next.hash, label: next.label } : null;
});

/**
 * 解析当前 hash；非法或为空时回落到第 1 层（用 replaceState 避免多触发一次渲染）。
 * @returns {object} 命中的路由
 */
function resolveRoute() {
  const currentHash = window.location.hash;
  const matched = ROUTES.find((route) => route.hash === currentHash);
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
 * @param {{ ctx: {data: object, result: object}, mount: HTMLElement }} options
 */
export function createRouter({ ctx, mount }) {
  function render(route) {
    disposeCharts();
    setActiveNav(route.id);
    setPageHeader(route, ROUTES);
    setInsight(ctx.result.insights[route.insightKey]);
    setPageFoot(route, ROUTES);

    mount.innerHTML = "";
    mount.dataset.page = route.id;

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
      const route = resolveRoute();
      render(route);
      window.addEventListener("hashchange", onHashChange);
      window.addEventListener("resize", onResize);
    },
  };
}
