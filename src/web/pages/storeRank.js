/**
 * 第 3 层 · 门店排名页（对应 PPT 第 20 页 / Excel 表2-收入区域 / 门店分析）。
 *
 * 同店门店三种排名：本期收入、同比增长额、同比增长率。
 * 新店不参与增长额 / 增长率排名（引擎已按同店筛选）。
 * 每列上方是排名柱状图（前 8 名），下方是完整排名明细表。
 */

import { createChart, rankBarOption } from "../charts.js";
import { fmtSignedPct, fmtSignedWan, fmtWan, htmlEsc, toneOf } from "../format.js";
import { panelHTML, rankBadge, tableHTML } from "../ui.js";

const COLOR_BLUE = "#1d4ed8";
const colorBySign = (value) => (value >= 0 ? "#15803d" : "#b91c1c");

export const storeRankPage = {
  id: "store-rank",

  render(root, ctx) {
    const { store_rank: rank } = ctx.result;

    const panels = [
      {
        id: "revenue",
        title: "收入排名",
        subtitle: "本期收入由高到低 · 单位：万元",
        valueLabel: "本期收入",
        rows: rank.by_revenue,
        chartItems: rank.by_revenue.map((row) => ({ name: row.store, value: row.current })),
        chartFormatter: fmtWan,
        cellFormatter: (row) => fmtWan(row.current),
        cellTone: () => "flat",
        colorFor: () => COLOR_BLUE,
      },
      {
        id: "growth-amount",
        title: "增长额排名",
        subtitle: "同比增长额由高到低 · 单位：万元",
        valueLabel: "同比差额",
        rows: rank.by_growth_amount,
        chartItems: rank.by_growth_amount.map((row) => ({ name: row.store, value: row.diff })),
        chartFormatter: fmtSignedWan,
        cellFormatter: (row) => fmtSignedWan(row.diff),
        cellTone: (row) => toneOf(row.diff),
        colorFor: colorBySign,
      },
      {
        id: "growth-rate",
        title: "增长率排名",
        subtitle: "同比增长率由高到低 · 新店不参与",
        valueLabel: "增减率",
        rows: rank.by_growth_rate,
        chartItems: rank.by_growth_rate.map((row) => ({ name: row.store, value: row.growth_rate ?? 0 })),
        chartFormatter: fmtSignedPct,
        cellFormatter: (row) => fmtSignedPct(row.growth_rate),
        cellTone: (row) => toneOf(row.growth_rate),
        colorFor: colorBySign,
        axisFormatter: (value) => `${(value * 100).toFixed(0)}%`,
      },
    ];

    root.innerHTML = `<div class="grid grid--rank">${panels.map((panel) => rankPanel(panel)).join("")}</div>`;

    for (const panel of panels) {
      createChart(
        root.querySelector(`#chart-rank-${panel.id}`),
        rankBarOption({
          items: panel.chartItems.slice(0, 8),
          valueFormatter: panel.chartFormatter,
          colorFor: panel.colorFor,
          axisFormatter: panel.axisFormatter,
        }),
      );
    }
  },
};

/**
 * 单个排名面板：排名柱状图（前 8 名）+ 完整排名明细表。
 * @param {object} panel
 */
function rankPanel(panel) {
  const columns = [
    { label: "排名", align: "left", width: "18%" },
    { label: "门店", align: "left", width: "38%" },
    { label: panel.valueLabel, width: "44%" },
  ];
  const rows = panel.rows.map((row) => ({
    cells: [rankBadge(row.rank), htmlEsc(row.store), { html: panel.cellFormatter(row), tone: panel.cellTone(row) }],
  }));

  return panelHTML({
    title: panel.title,
    subtitle: panel.subtitle,
    body: `<div class="chart chart--rank" id="chart-rank-${panel.id}"></div>
      <div class="table-wrap">${tableHTML({ columns, rows, className: "tbl--compact" })}</div>`,
    note: "图表展示前 8 名，完整排名见下方表格；新店不参与增长额 / 增长率排名。",
  });
}
