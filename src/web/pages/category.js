/**
 * 第 4 层 · 品类量价因素页（对应 PPT 第 29 页 / Excel 收入异动表3）。
 *
 * 全店 / 同店口径切换 + 因素瀑布图 + 量价明细表。
 * 瀑布图：同期收入起点 → 各品类收入影响 → 本期收入终点，增收绿、减收红。
 */

import { createChart, waterfallOption } from "../charts.js";
import { fmtSignedWan, fmtWan, htmlEsc, toneOf } from "../format.js";
import { panelHTML, tableHTML } from "../ui.js";

export const categoryPage = {
  id: "category",

  render(root, ctx) {
    const { category_qty_price: category } = ctx.result;
    const state = { mode: "all" };

    root.innerHTML = `<div class="grid grid--category">
      ${panelHTML({
        title: "收入因素瀑布图",
        subtitle: "同期收入 → 各品类影响 → 本期收入 · 单位：万元",
        actions: `<div class="segmented" id="category-toggle" role="group" aria-label="口径切换">
            <button type="button" class="seg-btn active" data-mode="all" aria-pressed="true">全店口径</button>
            <button type="button" class="seg-btn" data-mode="same_store" aria-pressed="false">同店口径</button>
          </div>`,
        body: '<div class="chart" id="chart-category-waterfall"></div>',
        note: '<span id="category-mode-note"></span>',
      })}
      ${panelHTML({
        title: "品类量价明细",
        subtitle: "单位：万元 · 销量影响 = 销量差 × 同期单价；单价影响 = 单价差 × 本期销量",
        body: '<div class="table-wrap" id="category-table-wrap"></div>',
        note: "各品类行 销量影响 + 单价影响 = 收入差；合计行按列纵向加总。",
      })}
    </div>`;

    const chartElement = root.querySelector("#chart-category-waterfall");
    const tableWrap = root.querySelector("#category-table-wrap");
    const modeNote = root.querySelector("#category-mode-note");
    const baseTotal = ctx.data.categories.reduce((sum, item) => sum + (item.base?.revenue ?? 0), 0);

    const refresh = () => {
      const rows = category[state.mode];
      const bodyRows = rows.filter((row) => row.category !== "合计");
      const totalRow = rows.find((row) => row.category === "合计");
      const endTotal = baseTotal + (totalRow?.total ?? 0);

      createChart(
        chartElement,
        waterfallOption({
          startLabel: "同期收入",
          startValue: baseTotal,
          steps: bodyRows.map((row) => ({ name: row.category, value: row.total })),
          endLabel: "本期收入",
        }),
      );

      tableWrap.innerHTML = buildCategoryTable(rows);

      modeNote.textContent =
        state.mode === "all"
          ? `当前口径：全店（含新店）· 起点 ${fmtWan(baseTotal)} 万元 → 终点 ${fmtWan(endTotal)} 万元。`
          : `当前口径：同店（按同店收入占比折算，课程演示口径）· 起点 ${fmtWan(baseTotal)} 万元 → 终点 ${fmtWan(endTotal)} 万元。`;
    };

    root.querySelector("#category-toggle").addEventListener("click", (event) => {
      const button = event.target.closest(".seg-btn");
      if (!button || button.dataset.mode === state.mode) return;
      state.mode = button.dataset.mode;
      for (const candidate of root.querySelectorAll("#category-toggle .seg-btn")) {
        const active = candidate === button;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-pressed", String(active));
      }
      refresh();
    });

    refresh();
  },
};

/**
 * 品类量价明细表：品类 / 销量影响 / 单价影响 / 合计（末尾合计行单独样式）。
 * @param {Array<object>} rows 含「合计」行
 */
function buildCategoryTable(rows) {
  const columns = [
    { label: "品类", align: "left", width: "26%" },
    { label: "销量影响", width: "24%" },
    { label: "单价影响", width: "24%" },
    { label: "合计", width: "26%" },
  ];

  const body = rows.map((row) => {
    const isTotal = row.category === "合计";
    return {
      className: isTotal ? "total-row" : "",
      cells: [
        htmlEsc(row.category),
        { html: fmtSignedWan(row.qty_effect), tone: toneOf(row.qty_effect) },
        { html: fmtSignedWan(row.price_effect), tone: toneOf(row.price_effect) },
        { html: fmtSignedWan(row.total), tone: toneOf(row.total) },
      ],
    };
  });

  return tableHTML({ columns, rows: body });
}
