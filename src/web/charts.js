/**
 * ECharts 图表封装。
 *
 * 统一处理三件事：
 * 1. 图表实例生命周期：路由切换时 dispose，窗口 resize 时 resize；
 * 2. 图表主题：固定字体、关闭动画（课堂投影和截图更稳定）；
 * 3. ECharts CDN 未加载时的降级提示：图表位置给可读提示，表格数据不受影响。
 *
 * 所有图表单位统一为万元（门店客流客单图由页面先换算成万元再传入）。
 */

import { fmtPct, fmtSignedWan, fmtWan } from "./format.js";

const FONT_FAMILY =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, -apple-system, sans-serif';

const AXIS_LABEL = { fontSize: 12.5, color: "#475569" };
const AXIS_LINE = { lineStyle: { color: "#cbd5e1" } };
const AXIS_TICK = { show: false };
const SPLIT_LINE = { lineStyle: { color: "#eef2f7" } };
const TOOLTIP = {
  backgroundColor: "rgba(15, 23, 42, 0.92)",
  borderWidth: 0,
  padding: [8, 12],
  textStyle: { color: "#f8fafc", fontSize: 13, fontFamily: FONT_FAMILY },
};
const POS_COLOR = "#15803d";
const NEG_COLOR = "#b91c1c";
const PALETTE = [
  "#1d4ed8",
  "#0ea5e9",
  "#14b8a6",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#64748b",
  "#22c55e",
  "#e11d48",
  "#0f766e",
];

/** 元素 → 图表实例，用于统一 dispose / resize。 */
const chartInstances = new Map();

/** ECharts 是否可用（CDN 可能加载失败）。 */
export function echartsReady() {
  return typeof window !== "undefined" && Boolean(window.echarts);
}

/**
 * 在元素上创建（或替换）图表。
 * 同一个元素重复调用会先销毁旧实例，避免口径切换时图表叠加。
 * @param {HTMLElement|null} element
 * @param {object} option ECharts option
 * @returns {object|null} 图表实例；ECharts 不可用时返回 null
 */
export function createChart(element, option) {
  if (!element) return null;
  const previous = chartInstances.get(element);
  if (previous) {
    try {
      previous.dispose();
    } catch {
      /* 实例已销毁时忽略 */
    }
    chartInstances.delete(element);
  }
  if (!echartsReady()) {
    element.classList.add("chart--fallback");
    element.innerHTML =
      '<div class="chart-fallback">图表库未能从 CDN 加载，本页图表暂不显示；下方表格数据不受影响。<br />请检查网络后刷新页面。</div>';
    return null;
  }
  const chart = window.echarts.init(element, null, { renderer: "canvas" });
  chart.setOption(option);
  chartInstances.set(element, chart);
  return chart;
}

/** 销毁当前页面所有图表实例（路由切换时调用）。 */
export function disposeCharts() {
  for (const chart of chartInstances.values()) {
    try {
      chart.dispose();
    } catch {
      /* 忽略重复销毁 */
    }
  }
  chartInstances.clear();
}

/** 窗口尺寸变化时重排图表。 */
export function resizeCharts() {
  for (const chart of chartInstances.values()) {
    try {
      chart.resize();
    } catch {
      /* 忽略已脱离文档的实例 */
    }
  }
}

/** 图表通用基底。 */
function baseOption() {
  return {
    animation: false,
    textStyle: { fontFamily: FONT_FAMILY },
    color: PALETTE,
  };
}

/**
 * 占比环形图（渠道占比、同店 / 新店结构）。
 * @param {{ items: Array<{name: string, value: number, share: number|null}>, centerTitle: string, centerSubtitle: string }} options
 */
export function sharePieOption({ items, centerTitle, centerSubtitle }) {
  const shareByName = new Map(items.map((item) => [item.name, item.share]));
  return {
    ...baseOption(),
    tooltip: {
      ...TOOLTIP,
      trigger: "item",
      formatter: (params) => `${params.name}<br />${fmtWan(params.value)} 万元（${params.percent}%）`,
    },
    legend: {
      bottom: 0,
      left: "center",
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 12,
      textStyle: { fontSize: 12.5, color: "#334155" },
      formatter: (name) => {
        const share = shareByName.get(name);
        return share === null || share === undefined ? name : `${name} ${fmtPct(share)}`;
      },
    },
    title: {
      text: centerTitle,
      subtext: centerSubtitle,
      left: "center",
      top: "37%",
      textAlign: "center",
      textStyle: { fontSize: 22, fontWeight: 700, color: "#0f172a" },
      subtextStyle: { fontSize: 12.5, color: "#64748b" },
      itemGap: 6,
    },
    series: [
      {
        type: "pie",
        radius: ["46%", "68%"],
        center: ["50%", "41%"],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
        data: items.map((item) => ({ name: item.name, value: item.value })),
      },
    ],
  };
}

/**
 * 同期 / 本期对比柱状图（渠道页使用横向柱状，按本期收入排序）。
 * @param {{ categories: string[], series: Array<{name: string, data: number[], color: string}>, horizontal?: boolean, labelSeriesName?: string }} options
 */
export function comparisonBarOption({ categories, series, horizontal = false, labelSeriesName = "" }) {
  const reversedCategories = [...categories].reverse();
  return {
    ...baseOption(),
    color: series.map((item) => item.color),
    tooltip: {
      ...TOOLTIP,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params) => {
        const lines = [params[0].axisValue];
        for (const item of params) lines.push(`${item.marker}${item.seriesName}：${fmtWan(item.value)} 万元`);
        return lines.join("<br />");
      },
    },
    legend: {
      top: 0,
      right: 0,
      itemWidth: 12,
      itemHeight: 10,
      textStyle: { fontSize: 13, color: "#334155" },
    },
    grid: horizontal
      ? { left: 4, right: 58, top: 36, bottom: 0, containLabel: true }
      : { left: 8, right: 16, top: 44, bottom: 0, containLabel: true },
    xAxis: horizontal
      ? { type: "value", axisLine: { show: false }, axisTick: AXIS_TICK, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE }
      : {
          type: "category",
          data: categories,
          axisLine: AXIS_LINE,
          axisTick: AXIS_TICK,
          axisLabel: { ...AXIS_LABEL, fontSize: 14 },
        },
    yAxis: horizontal
      ? {
          type: "category",
          data: reversedCategories,
          axisLine: AXIS_LINE,
          axisTick: AXIS_TICK,
          axisLabel: { fontSize: 12.5, color: "#334155" },
        }
      : { type: "value", axisLine: { show: false }, axisTick: AXIS_TICK, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
    series: series.map((item) => ({
      name: item.name,
      type: "bar",
      barMaxWidth: 14,
      itemStyle: {
        color: item.color,
        borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0],
      },
      label: {
        show: item.name === labelSeriesName,
        position: horizontal ? "right" : "top",
        fontSize: 12,
        color: "#475569",
        formatter: (params) => fmtWan(params.value),
      },
      data: horizontal ? [...item.data].reverse() : item.data,
    })),
  };
}

/**
 * 堆叠柱状图（同店 / 新店结构同比：同期 vs 本期，两个分组）。
 * @param {{ categories: string[], series: Array<{name: string, data: number[], color: string}> }} options
 */
export function stackedBarOption({ categories, series }) {
  return {
    ...baseOption(),
    color: series.map((item) => item.color),
    tooltip: {
      ...TOOLTIP,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params) => {
        const lines = [params[0].axisValue];
        for (const item of params) lines.push(`${item.marker}${item.seriesName}：${fmtWan(item.value)} 万元`);
        return lines.join("<br />");
      },
    },
    legend: {
      top: 0,
      right: 0,
      itemWidth: 12,
      itemHeight: 10,
      textStyle: { fontSize: 13, color: "#334155" },
    },
    grid: { left: 8, right: 16, top: 44, bottom: 4, containLabel: true },
    xAxis: {
      type: "category",
      data: categories,
      axisLine: AXIS_LINE,
      axisTick: AXIS_TICK,
      axisLabel: { ...AXIS_LABEL, fontSize: 14 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: AXIS_TICK,
      axisLabel: AXIS_LABEL,
      splitLine: SPLIT_LINE,
    },
    series: series.map((item) => ({
      name: item.name,
      type: "bar",
      stack: "total",
      barMaxWidth: 96,
      itemStyle: { color: item.color, borderColor: "#fff", borderWidth: 1 },
      label: {
        show: true,
        position: "inside",
        fontSize: 13,
        fontWeight: 600,
        color: "#fff",
        formatter: (params) => (params.value ? fmtWan(params.value) : ""),
      },
      data: item.data,
    })),
  };
}

/**
 * 因素瀑布图：同期收入起点 → 各品类影响 → 本期收入终点。
 * 用「透明占位条 + 实际影响条」两个 stack 系列实现（ECharts 标准瀑布图写法）。
 * 增收为绿色、减收为红色。
 *
 * @param {{ startLabel: string, startValue: number, steps: Array<{name: string, value: number}>, endLabel: string }} options
 */
export function waterfallOption({ startLabel, startValue, steps, endLabel }) {
  const labels = [startLabel, ...steps.map((step) => step.name), endLabel];
  const placeholders = [0];
  const bars = [startValue];
  const colors = ["#64748b"];
  const details = [{ label: startLabel, kind: "start", value: startValue, running: startValue }];
  let running = startValue;

  for (const step of steps) {
    const value = Number(step.value) || 0;
    if (value >= 0) {
      placeholders.push(running);
      bars.push(value);
      running += value;
      colors.push(POS_COLOR);
    } else {
      running += value;
      placeholders.push(running);
      bars.push(-value);
      colors.push(NEG_COLOR);
    }
    details.push({ label: step.name, kind: "step", value, running });
  }

  placeholders.push(0);
  bars.push(running);
  colors.push("#1d4ed8");
  details.push({ label: endLabel, kind: "end", value: running, running });

  return {
    ...baseOption(),
    tooltip: {
      ...TOOLTIP,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params) => {
        const detail = details[params[0].dataIndex];
        if (!detail) return "";
        if (detail.kind === "start") return `${detail.label}：${fmtWan(detail.value)} 万元`;
        if (detail.kind === "end") return `${detail.label}：${fmtWan(detail.value)} 万元`;
        return `${detail.label} 收入影响：${fmtSignedWan(detail.value)} 万元<br />累计收入：${fmtWan(detail.running)} 万元`;
      },
    },
    grid: { left: 8, right: 12, top: 30, bottom: 4, containLabel: true },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: AXIS_LINE,
      axisTick: AXIS_TICK,
      axisLabel: { fontSize: 12.5, color: "#475569", interval: 0 },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLine: { show: false },
      axisTick: AXIS_TICK,
      axisLabel: AXIS_LABEL,
      splitLine: SPLIT_LINE,
    },
    series: [
      {
        type: "bar",
        stack: "waterfall",
        silent: true,
        itemStyle: { color: "transparent" },
        emphasis: { disabled: true },
        tooltip: { show: false },
        data: placeholders,
      },
      {
        type: "bar",
        stack: "waterfall",
        barMaxWidth: 52,
        data: bars.map((value, index) => ({
          value,
          itemStyle: {
            color: colors[index],
            borderRadius: colors[index] === POS_COLOR ? [3, 3, 0, 0] : [0, 0, 0, 0],
          },
        })),
        label: {
          show: true,
          position: "top",
          fontSize: 12,
          color: "#334155",
          formatter: (params) => {
            const detail = details[params.dataIndex];
            if (!detail) return "";
            if (detail.kind === "step") return fmtSignedWan(detail.value);
            return fmtWan(detail.value);
          },
        },
      },
    ],
  };
}

/**
 * 排名横向柱状图（收入 / 增长额 / 增长率）。
 * @param {{ items: Array<{name: string, value: number}>, valueFormatter?: (value: number) => string, axisFormatter?: (value: number) => string, colorFor?: (value: number) => string }} options
 */
export function rankBarOption({ items, valueFormatter = fmtWan, axisFormatter, colorFor }) {
  const reversed = [...items].reverse();
  return {
    ...baseOption(),
    tooltip: {
      ...TOOLTIP,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params) => `${params[0].axisValue}：${valueFormatter(params[0].value)}`,
    },
    grid: { left: 4, right: 62, top: 6, bottom: 0, containLabel: true },
    xAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: AXIS_TICK,
      axisLabel: { ...AXIS_LABEL, formatter: axisFormatter },
      splitLine: SPLIT_LINE,
    },
    yAxis: {
      type: "category",
      data: reversed.map((item) => item.name),
      axisLine: { show: false },
      axisTick: AXIS_TICK,
      axisLabel: { fontSize: 12.5, color: "#334155" },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 18,
        data: reversed.map((item) => ({
          value: item.value,
          itemStyle: {
            color: colorFor ? colorFor(item.value) : "#1d4ed8",
            borderRadius: item.value >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
          },
          label: {
            position: item.value >= 0 ? "right" : "left",
            show: true,
            fontSize: 12,
            color: "#475569",
            formatter: () => valueFormatter(item.value),
          },
        })),
      },
    ],
  };
}

/**
 * 门店客流 / 客单影响横向对比柱状图（万元）。
 * @param {{ items: Array<{store: string, traffic: number, ticket: number}> }} options
 */
export function storeEffectBarOption({ items }) {
  const reversed = [...items].reverse();
  return {
    ...baseOption(),
    color: ["#1d4ed8", "#0ea5e9"],
    tooltip: {
      ...TOOLTIP,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params) =>
        [params[0].axisValue, ...params.map((item) => `${item.marker}${item.seriesName}：${fmtSignedWan(item.value)} 万元`)].join(
          "<br />",
        ),
    },
    legend: {
      top: 0,
      right: 0,
      itemWidth: 12,
      itemHeight: 10,
      textStyle: { fontSize: 13, color: "#334155" },
    },
    grid: { left: 4, right: 16, top: 36, bottom: 0, containLabel: true },
    xAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: AXIS_TICK,
      axisLabel: AXIS_LABEL,
      splitLine: SPLIT_LINE,
    },
    yAxis: {
      type: "category",
      data: reversed.map((item) => item.store),
      axisLine: AXIS_LINE,
      axisTick: AXIS_TICK,
      axisLabel: { fontSize: 12.5, color: "#334155" },
    },
    series: [
      {
        name: "客流影响",
        type: "bar",
        barMaxWidth: 10,
        data: reversed.map((item) => item.traffic),
        itemStyle: { borderRadius: 3 },
      },
      {
        name: "客单影响",
        type: "bar",
        barMaxWidth: 10,
        data: reversed.map((item) => item.ticket),
        itemStyle: { borderRadius: 3 },
      },
    ],
  };
}

