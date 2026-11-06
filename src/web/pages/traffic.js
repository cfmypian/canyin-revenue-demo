/**
 * 第 5 层 · 客流客单页（对应 PPT 第 22-23 页 / Excel 收入异动表5、表6）。
 *
 * 左：同店品类三因素表（客流 / 人均销量 / 单价，单位万元）；
 * 中：门店客流 / 客单影响对比图（万元）；
 * 右：门店客流 × 客单两因素表（原始单位元，末列附万元换算）。
 *
 * 注意：三因素合计行的「人均销量影响」按 Excel 基准记 0.00 万元，
 * 页面只用脚注解释口径，不写“人均销量无影响”这类误导文案。
 */

import { createChart, storeEffectBarOption } from "../charts.js";
import { fmtSignedWan, fmtSignedYuan, fmtYuan, htmlEsc, toneOf, wanFromYuan } from "../format.js";
import { panelHTML, tableHTML } from "../ui.js";

export const trafficPage = {
  id: "traffic",

  render(root, ctx) {
    const { traffic } = ctx.result;

    root.innerHTML = `<div class="grid grid--traffic">
      ${panelHTML({
        title: "同店品类三因素",
        subtitle: "单位：万元 · 连环替代顺序：客流 → 人均销量 → 单价",
        body: `<div class="table-wrap">${buildCategoryTable(traffic.categories)}</div>`,
        note: "合计行「人均销量影响」按 Excel 基准记 0.00（人均销量为比率，合计行不做纵向加总）；各品类行 客流 + 人均销量 + 单价 = 收入差。",
      })}
      ${panelHTML({
        title: "门店客流 / 客单影响",
        subtitle: "单位：万元 · 13 家同店",
        body: '<div class="chart" id="chart-traffic-store"></div>',
      })}
      ${panelHTML({
        title: "门店客流 × 客单两因素",
        subtitle: "金额原始单位为元 · 末列附万元换算",
        body: `<div class="table-wrap">${buildStoreTable(traffic.stores)}</div>`,
        note: "客流影响 = 客流差 × 同期客单；客单影响 = 客单差 × 本期客流；两者之和 = 收入差（元）。",
      })}
    </div>`;

    const chartItems = traffic.stores
      .filter((row) => row.store !== "同店对比")
      .map((row) => ({
        store: row.store,
        traffic: wanFromYuan(row.traffic_effect),
        ticket: wanFromYuan(row.ticket_effect),
      }));

    createChart(root.querySelector("#chart-traffic-store"), storeEffectBarOption({ items: chartItems }));
  },
};

/**
 * 同店品类三因素表（客流 / 人均销量 / 单价，单位万元）。
 * @param {Array<object>} rows 含「合计」行
 */
function buildCategoryTable(rows) {
  const columns = [
    { label: "品类", align: "left", width: "24%" },
    { label: "客流影响", width: "19%" },
    { label: "人均销量影响", width: "20%" },
    { label: "单价影响", width: "19%" },
    { label: "合计", width: "18%" },
  ];

  const body = rows.map((row) => ({
    className: row.category === "合计" ? "total-row" : "",
    cells: [
      htmlEsc(row.category),
      { html: fmtSignedWan(row.traffic_effect), tone: toneOf(row.traffic_effect) },
      { html: fmtSignedWan(row.per_capita_qty_effect), tone: toneOf(row.per_capita_qty_effect) },
      { html: fmtSignedWan(row.price_effect), tone: toneOf(row.price_effect) },
      { html: fmtSignedWan(row.total), tone: toneOf(row.total) },
    ],
  }));

  return tableHTML({ columns, rows: body });
}

/**
 * 门店客流 × 客单两因素表：门店 / 本期收入 / 同期收入 / 客流影响 / 客单影响 / 合计（元）+ 合计（万元）。
 * @param {Array<object>} rows 含「同店对比」行
 */
function buildStoreTable(rows) {
  const columns = [
    { label: "门店", align: "left", width: "14%" },
    { label: "本期收入", width: "14.5%" },
    { label: "同期收入", width: "14.5%" },
    { label: "客流影响", width: "14%" },
    { label: "客单影响", width: "14%" },
    { label: "合计", width: "14.5%" },
    { label: "合计（万元）", width: "14.5%" },
  ];

  const body = rows.map((row) => ({
    className: row.store === "同店对比" ? "total-row" : "",
    cells: [
      htmlEsc(row.store),
      fmtYuan(row.revenue_current),
      fmtYuan(row.revenue_base),
      { html: fmtSignedYuan(row.traffic_effect), tone: toneOf(row.traffic_effect) },
      { html: fmtSignedYuan(row.ticket_effect), tone: toneOf(row.ticket_effect) },
      { html: fmtSignedYuan(row.total), tone: toneOf(row.total) },
      { html: fmtSignedWan(wanFromYuan(row.total)), tone: toneOf(row.total) },
    ],
  }));

  return tableHTML({ columns, rows: body });
}
