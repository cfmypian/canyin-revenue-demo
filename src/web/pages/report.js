/**
 * 分析报告页（工具页 `#/report`）。
 *
 * 按月度经营分析汇报顺序：封面 → 收入总览 → 五层章节（结论 + 主图 + 关键表）→ 结论汇总。
 * 数字与结论全部来自 ctx.result（与看板同一次 analyze），版式数据由 reportModel 生成。
 *
 * 打印：「打印 / 导出 PDF」调用 window.print()；打印样式见 styles.css 的 @media print。
 * 打印前后重排图表（beforeprint / afterprint），避免图表按屏幕宽度被裁切。
 */

import {
  createChart,
  rankBarOption,
  resizeCharts,
  sharePieOption,
  stackedBarOption,
  storeEffectBarOption,
  waterfallOption,
} from "../charts.js";
import { fmtPct, fmtSignedPct, fmtSignedWan, fmtWan, htmlEsc, toneOf, wanFromYuan } from "../format.js";
import { buildReportModel } from "../reportModel.js";
import { tableHTML } from "../ui.js";

const signed = (value) => ({ html: fmtSignedWan(value), tone: toneOf(value) });
const signedPct = (value) => ({ html: fmtSignedPct(value), tone: toneOf(value) });

/** 报告时间：YYYY-MM-DD HH:mm。 */
function stamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 各章节的主图与关键表。返回 { table, chart: () => option }。 */
function chapterContent(id, ctx) {
  const { result, data } = ctx;
  switch (id) {
    case "channel": {
      const rows = [...result.channel.rows].sort((a, b) => b.current - a.current);
      return {
        chart: () =>
          sharePieOption({
            items: rows.map((row) => ({ name: row.channel, value: row.current, share: row.share })),
            centerTitle: fmtWan(result.channel.current_total),
            centerSubtitle: "本期合计（万元）",
          }),
        table: tableHTML({
          columns: [
            { label: "渠道", align: "left" },
            { label: "同期" },
            { label: "本期" },
            { label: "占比" },
            { label: "同比差额" },
            { label: "增减率" },
          ],
          rows: [
            ...rows.map((row) => ({
              cells: [htmlEsc(row.channel), fmtWan(row.base), fmtWan(row.current), fmtPct(row.share), signed(row.diff), signedPct(row.growth_rate)],
            })),
            {
              className: "total-row",
              cells: [
                "合计",
                fmtWan(result.channel.base_total),
                fmtWan(result.channel.current_total),
                "100.00%",
                signed(result.channel.diff),
                signedPct(result.channel.growth_rate),
              ],
            },
          ],
        }),
      };
    }
    case "store-mix": {
      const mix = result.store_mix;
      return {
        chart: () =>
          stackedBarOption({
            categories: [`${data.period?.base ?? ""} 同期`.trim(), `${data.period?.current ?? ""} 本期`.trim()],
            series: [
              { name: "同店", color: "#1d4ed8", data: [mix.same_store_base, mix.same_store_current] },
              { name: "新店", color: "#f59e0b", data: [0, mix.new_store_current] },
            ],
          }),
        table: tableHTML({
          columns: [{ label: "口径", align: "left" }, { label: "同期" }, { label: "本期" }, { label: "同比差额" }, { label: "增减率" }, { label: "本期占比" }],
          rows: [
            {
              cells: [
                "同店",
                fmtWan(mix.same_store_base),
                fmtWan(mix.same_store_current),
                signed(mix.same_store_diff),
                signedPct(mix.same_store_growth),
                fmtPct(mix.same_store_ratio),
              ],
            },
            {
              cells: ["新店", "—", fmtWan(mix.new_store_current), signed(mix.new_store_current), "—", fmtPct(1 - mix.same_store_ratio)],
            },
            {
              className: "total-row",
              cells: [
                "门店合计",
                fmtWan(mix.same_store_base),
                fmtWan(mix.total_current),
                signed(mix.total_current - mix.same_store_base),
                signedPct(mix.same_store_base ? (mix.total_current - mix.same_store_base) / mix.same_store_base : null),
                "100.00%",
              ],
            },
          ],
        }),
      };
    }
    case "store-rank": {
      const rank = result.store_rank;
      const top = Math.min(5, Math.max(rank.by_revenue.length, rank.by_growth_amount.length, rank.by_growth_rate.length));
      const rows = [];
      for (let i = 0; i < top; i += 1) {
        const a = rank.by_revenue[i];
        const b = rank.by_growth_amount[i];
        const c = rank.by_growth_rate[i];
        rows.push({
          cells: [
            String(i + 1),
            a ? `${htmlEsc(a.store)} · ${fmtWan(a.current)}` : "—",
            b ? { html: `${htmlEsc(b.store)} · ${fmtSignedWan(b.diff)}`, tone: toneOf(b.diff) } : "—",
            c ? { html: `${htmlEsc(c.store)} · ${fmtSignedPct(c.growth_rate)}`, tone: toneOf(c.growth_rate) } : "—",
          ],
        });
      }
      return {
        chart: () =>
          rankBarOption({
            items: rank.by_growth_amount.slice(0, 8).map((row) => ({ name: row.store, value: row.diff })),
            valueFormatter: fmtSignedWan,
            colorFor: (value) => (value >= 0 ? "#15803d" : "#b91c1c"),
          }),
        chartTitle: "同店门店增长额前 8 名（万元）",
        table: tableHTML({
          columns: [{ label: "名次", align: "left" }, { label: "收入排名", align: "left" }, { label: "增长额排名", align: "left" }, { label: "增长率排名", align: "left" }],
          rows,
        }),
      };
    }
    case "category": {
      const all = result.category_qty_price.all;
      const sameStore = result.category_qty_price.same_store;
      const baseTotal = data.categories.reduce((sum, item) => sum + (item.base?.revenue ?? 0), 0);
      return {
        chart: () =>
          waterfallOption({
            startLabel: "同期收入",
            startValue: baseTotal,
            steps: all.filter((row) => row.category !== "合计").map((row) => ({ name: row.category, value: row.total })),
            endLabel: "本期收入",
          }),
        chartTitle: "全店口径收入因素瀑布图（万元）",
        table: tableHTML({
          columns: [
            { label: "品类", align: "left" },
            { label: "全店销量影响" },
            { label: "全店单价影响" },
            { label: "全店合计" },
            { label: "同店合计" },
          ],
          rows: all.map((row) => {
            const same = sameStore.find((item) => item.category === row.category);
            return {
              className: row.category === "合计" ? "total-row" : "",
              cells: [htmlEsc(row.category), signed(row.qty_effect), signed(row.price_effect), signed(row.total), signed(same?.total ?? 0)],
            };
          }),
        }),
      };
    }
    case "traffic": {
      const { traffic } = result;
      return {
        chart: () =>
          storeEffectBarOption({
            items: traffic.stores
              .filter((row) => row.store !== "同店对比")
              .map((row) => ({ store: row.store, traffic: wanFromYuan(row.traffic_effect), ticket: wanFromYuan(row.ticket_effect) })),
          }),
        chartTitle: "门店客流 / 客单影响（万元，由元换算）",
        table: tableHTML({
          columns: [{ label: "品类", align: "left" }, { label: "客流影响" }, { label: "人均销量影响" }, { label: "单价影响" }, { label: "合计" }],
          rows: traffic.categories.map((row) => ({
            className: row.category === "合计" ? "total-row" : "",
            cells: [htmlEsc(row.category), signed(row.traffic_effect), signed(row.per_capita_qty_effect), signed(row.price_effect), signed(row.total)],
          })),
        }),
      };
    }
    default:
      return { chart: null, table: "" };
  }
}

let printHandlers = null;

function removePrintHandlers() {
  if (!printHandlers) return;
  window.removeEventListener("beforeprint", printHandlers.before);
  window.removeEventListener("afterprint", printHandlers.after);
  printHandlers = null;
}

export const reportPage = {
  id: "report",

  render(root, ctx) {
    const model = buildReportModel(ctx);
    const contents = Object.fromEntries(model.chapters.map((chapter) => [chapter.id, chapterContent(chapter.id, ctx)]));
    const { cover, overview } = model;

    root.innerHTML = `<div class="report-wrap">
      <div class="report-toolbar">
        <span>报告内容与当前看板数据一致（${htmlEsc(cover.sourceText)}）</span>
        <button type="button" class="btn btn--primary" id="btn-print">打印 / 导出 PDF</button>
      </div>
      <article class="report-doc" id="report-doc" data-source="${cover.sourceType}">
        <header class="report-cover">
          <p class="report-kicker">餐饮经营分析系统 · 收入分析模块</p>
          <h1 class="report-title">${htmlEsc(cover.title)}</h1>
          <dl class="report-meta">
            <div><dt>分析期间</dt><dd>${htmlEsc(cover.period.base)} 同期 → ${htmlEsc(cover.period.current)} 本期</dd></div>
            <div><dt>数据来源</dt><dd id="report-source">${htmlEsc(cover.sourceText)}</dd></div>
            <div><dt>生成时间</dt><dd>${stamp(cover.generatedAt)}</dd></div>
          </dl>
        </header>

        <section class="report-section" id="report-overview">
          <h2 class="report-h2">收入总览</h2>
          <div class="report-metrics">
            ${overview.metrics
              .map(
                (metric) => `<div class="report-metric" data-key="${metric.key}">
                  <p class="report-metric-label">${htmlEsc(metric.label)}</p>
                  <p class="report-metric-value ${metric.tone}">${metric.display}${metric.unit ? `<span>${htmlEsc(metric.unit)}</span>` : ""}</p>
                  <p class="report-metric-sub">${htmlEsc(metric.sub)}</p>
                </div>`,
              )
              .join("")}
          </div>
          <p class="report-insight">${htmlEsc(overview.insight)}</p>
        </section>

        ${model.chapters
          .map((chapter) => {
            const content = contents[chapter.id];
            return `<section class="report-section report-chapter" data-chapter="${chapter.id}">
              <h2 class="report-h2"><span class="report-level">第 ${chapter.level} 层</span>${htmlEsc(chapter.title)}</h2>
              <p class="report-insight"><strong>结论：</strong>${htmlEsc(chapter.insight)}</p>
              <figure class="report-figure">
                ${content.chartTitle ? `<figcaption>${htmlEsc(content.chartTitle)}</figcaption>` : ""}
                <div class="report-chart" id="report-chart-${chapter.id}"></div>
              </figure>
              <div class="report-table">${content.table}</div>
              ${chapter.notes.map((note) => `<p class="report-note">注：${htmlEsc(note)}</p>`).join("")}
            </section>`;
          })
          .join("")}

        <section class="report-section report-summary" id="report-summary">
          <h2 class="report-h2">结论汇总</h2>
          <ol class="report-summary-list">
            ${model.summary.map((item) => `<li><strong>${htmlEsc(item.title)}：</strong><span class="summary-text">${htmlEsc(item.insight)}</span></li>`).join("")}
          </ol>
          <p class="report-note">注：结论由计算结果按规则生成（最大正向 / 负向贡献项），不使用大模型。${cover.sourceType === "demo" ? "本报告使用演示数据。" : ""}</p>
        </section>
      </article>
    </div>`;

    for (const chapter of model.chapters) {
      const content = contents[chapter.id];
      if (content.chart) createChart(root.querySelector(`#report-chart-${chapter.id}`), content.chart());
    }

    root.querySelector("#btn-print").addEventListener("click", () => window.print());

    removePrintHandlers();
    printHandlers = {
      before: () => {
        document.body.classList.add("is-printing");
        resizeCharts();
      },
      after: () => {
        document.body.classList.remove("is-printing");
        resizeCharts();
      },
    };
    window.addEventListener("beforeprint", printHandlers.before);
    window.addEventListener("afterprint", printHandlers.after);
  },

  destroy() {
    removePrintHandlers();
  },
};
