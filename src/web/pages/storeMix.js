/**
 * 第 2 层 · 同店 / 新店结构页（对应 PPT 第 19、26 页 / Excel 收入异动表1、表2）。
 *
 * 同店 / 新店占比环形图 + 同期 / 本期结构对比图 + 同店渠道拆解表。
 * 同店口径为演示口径（渠道收入 × 同店收入占比），页面需注明。
 */

import { createChart, sharePieOption, stackedBarOption } from "../charts.js";
import { fmtPct, fmtSignedPct, fmtSignedWan, fmtWan, htmlEsc, toneOf } from "../format.js";
import { panelHTML, tableHTML } from "../ui.js";

export const storeMixPage = {
  id: "store-mix",

  render(root, ctx) {
    const { store_mix: mix } = ctx.result;
    const share = mix.same_store_ratio;
    const sameStoreShare = share ?? null;
    const newStoreShare = share === null || share === undefined ? null : 1 - share;
    const storeTotal = mix.same_store_current + mix.new_store_current;

    const channels = [...mix.channels].sort((a, b) => b.same_store - a.same_store);
    const totalSameStore = channels.reduce((sum, row) => sum + row.same_store, 0);
    const totalDiff = channels.reduce((sum, row) => sum + row.diff_vs_base, 0);
    const totalNewStore = channels.reduce((sum, row) => sum + row.new_store, 0);

    root.innerHTML = `<div class="grid grid--mix">
      ${panelHTML({
        title: "同店 / 新店收入结构",
        subtitle: `本期门店收入合计 ${fmtWan(storeTotal)} 万元`,
        body: '<div class="chart" id="chart-mix-share"></div>',
        note: `门店口径合计 ${fmtWan(storeTotal)} 万元，与顶部渠道口径 ${fmtWan(ctx.result.channel.current_total)} 万元差 ${fmtWan(storeTotal - ctx.result.channel.current_total)} 万元，为原始数据取整差异。`,
      })}
      ${panelHTML({
        title: "同期 / 本期结构对比",
        subtitle: `同店 ${fmtSignedWan(mix.same_store_diff)} 万元（${fmtSignedPct(mix.same_store_growth)}） · 新店 +${fmtWan(mix.new_store_current)} 万元（新增）`,
        body: '<div class="chart" id="chart-mix-compare"></div>',
      })}
      ${panelHTML({
        title: "同店渠道拆解",
        subtitle: "单位：万元 · 同店收入 = 渠道本期收入 × 同店收入占比",
        body: `<div class="table-wrap">${buildMixTable(channels, totalSameStore, totalDiff, totalNewStore)}</div>`,
        note: `同店渠道收入按同店收入占比 ${fmtPct(share)} 折算（课程演示口径，真实系统需按门店明细计算）；合计行为渠道行纵向加总（${fmtWan(totalSameStore)} 万元，与门店口径同店收入 ${fmtWan(mix.same_store_current)} 万元差 ${fmtWan(mix.same_store_current - totalSameStore)} 万元，为取整差异）。`,
      })}
    </div>`;

    createChart(
      root.querySelector("#chart-mix-share"),
      sharePieOption({
        items: [
          { name: "同店", value: mix.same_store_current, share: sameStoreShare },
          { name: "新店", value: mix.new_store_current, share: newStoreShare },
        ],
        centerTitle: fmtWan(storeTotal),
        centerSubtitle: "门店收入合计（万元）",
      }),
    );

    createChart(
      root.querySelector("#chart-mix-compare"),
      stackedBarOption({
        categories: [`${ctx.data.period?.base ?? ""} 同期`.trim(), `${ctx.data.period?.current ?? ""} 本期`.trim()],
        series: [
          { name: "同店", color: "#1d4ed8", data: [mix.same_store_base, mix.same_store_current] },
          { name: "新店", color: "#f59e0b", data: [0, mix.new_store_current] },
        ],
      }),
    );
  },
};

/**
 * 同店渠道拆解表：渠道 / 同店收入 / 同比差额 / 新店收入。
 * @param {Array<object>} rows 已按同店收入降序排列
 */
function buildMixTable(rows, totalSameStore, totalDiff, totalNewStore) {
  const columns = [
    { label: "渠道", align: "left", width: "30%" },
    { label: "同店收入", width: "23%" },
    { label: "同比差额", width: "23%" },
    { label: "新店收入", width: "24%" },
  ];

  const body = rows.map((row) => ({
    cells: [
      htmlEsc(row.channel),
      fmtWan(row.same_store),
      { html: fmtSignedWan(row.diff_vs_base), tone: toneOf(row.diff_vs_base) },
      fmtWan(row.new_store),
    ],
  }));

  body.push({
    className: "total-row",
    cells: [
      "合计",
      fmtWan(totalSameStore),
      { html: fmtSignedWan(totalDiff), tone: toneOf(totalDiff) },
      fmtWan(totalNewStore),
    ],
  });

  return tableHTML({ columns, rows: body });
}
