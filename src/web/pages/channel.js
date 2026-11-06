/**
 * 第 1 层 · 渠道收入结构页（对应 PPT 第 24-25 页 / Excel 表1-收入渠道分析）。
 *
 * 占比环形图 + 同期 / 本期对比柱状图 + 渠道明细表（合计行用渠道合计口径）。
 */

import { comparisonBarOption, createChart, sharePieOption } from "../charts.js";
import { fmtPct, fmtSignedPct, fmtSignedWan, fmtWan, htmlEsc, toneOf } from "../format.js";
import { panelHTML, tableHTML } from "../ui.js";

export const channelPage = {
  id: "channel",

  render(root, ctx) {
    const { channel } = ctx.result;
    const rows = [...channel.rows].sort((a, b) => b.current - a.current);

    root.innerHTML = `<div class="grid grid--channel">
      ${panelHTML({
        title: "本期收入占比",
        subtitle: `本期渠道合计 ${fmtWan(channel.current_total)} 万元`,
        body: '<div class="chart" id="chart-channel-share"></div>',
      })}
      ${panelHTML({
        title: "同期 / 本期对比",
        subtitle: "单位：万元 · 按本期收入由高到低",
        body: '<div class="chart" id="chart-channel-compare"></div>',
      })}
      ${panelHTML({
        title: "渠道明细",
        subtitle: "单位：万元 · 占比为占本期合计 · 增减率同期为 0 时显示 —",
        body: `<div class="table-wrap">${buildChannelTable(rows, channel)}</div>`,
        note: "合计行取渠道合计口径，与顶部「本期总收入」指标卡一致。",
      })}
    </div>`;

    createChart(
      root.querySelector("#chart-channel-share"),
      sharePieOption({
        items: rows.map((row) => ({ name: row.channel, value: row.current, share: row.share })),
        centerTitle: fmtWan(channel.current_total),
        centerSubtitle: "本期合计（万元）",
      }),
    );

    createChart(
      root.querySelector("#chart-channel-compare"),
      comparisonBarOption({
        categories: rows.map((row) => row.channel),
        series: [
          { name: "同期", data: rows.map((row) => row.base), color: "#93c5fd" },
          { name: "本期", data: rows.map((row) => row.current), color: "#1d4ed8" },
        ],
        horizontal: true,
        labelSeriesName: "本期",
      }),
    );
  },
};

/**
 * 渠道明细表：渠道 / 同期 / 本期 / 占比 / 同比差额 / 增减率。
 * @param {Array<object>} rows 已按本期收入降序排列
 * @param {object} channel 引擎 channel 结果（含合计口径）
 */
function buildChannelTable(rows, channel) {
  const columns = [
    { label: "渠道", align: "left", width: "24%" },
    { label: "同期", width: "14%" },
    { label: "本期", width: "14%" },
    { label: "占比", width: "14%" },
    { label: "同比差额", width: "17%" },
    { label: "增减率", width: "17%" },
  ];

  const body = rows.map((row) => ({
    cells: [
      htmlEsc(row.channel),
      fmtWan(row.base),
      fmtWan(row.current),
      fmtPct(row.share),
      { html: fmtSignedWan(row.diff), tone: toneOf(row.diff) },
      { html: fmtSignedPct(row.growth_rate), tone: toneOf(row.growth_rate) },
    ],
  }));

  body.push({
    className: "total-row",
    cells: [
      "合计",
      fmtWan(channel.base_total),
      fmtWan(channel.current_total),
      "100.00%",
      { html: fmtSignedWan(channel.diff), tone: toneOf(channel.diff) },
      { html: fmtSignedPct(channel.growth_rate), tone: toneOf(channel.growth_rate) },
    ],
  });

  return tableHTML({ columns, rows: body });
}
