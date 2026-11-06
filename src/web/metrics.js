/**
 * 首屏 5 项核心指标（看板指标卡与分析报告共用同一份口径，保证两处数字一致）。
 *
 * 纯函数：只读引擎结果，不碰 DOM，Node 测试可直接调用。
 */

import { fmtPct, fmtSignedPct, fmtSignedWan, fmtWan, toneOf } from "./format.js";

/**
 * @param {{ data: object, result: object }} context
 * @returns {Array<{ key: string, label: string, value: number|null, display: string, unit: string, sub: string, tone: string }>}
 */
export function buildMetrics({ data, result }) {
  const { channel, store_mix: storeMix } = result;
  const share = storeMix.same_store_ratio;
  const newStoreShare = share === null || share === undefined ? null : 1 - share;
  const currentPeriod = data?.period?.current ?? "本期";

  return [
    {
      key: "current_total",
      label: "本期总收入",
      value: channel.current_total,
      display: fmtWan(channel.current_total),
      unit: "万元",
      sub: `${currentPeriod} · 渠道合计口径`,
      tone: "accent",
    },
    {
      key: "diff",
      label: "同比差额",
      value: channel.diff,
      display: fmtSignedWan(channel.diff),
      unit: "万元",
      sub: `同期 ${fmtWan(channel.base_total)} 万元`,
      tone: toneOf(channel.diff),
    },
    {
      key: "growth_rate",
      label: "同比增长率",
      value: channel.growth_rate,
      display: fmtSignedPct(channel.growth_rate),
      unit: "",
      sub: "渠道合计口径",
      tone: toneOf(channel.growth_rate),
    },
    {
      key: "same_store_growth",
      label: "同店增长率",
      value: storeMix.same_store_growth,
      display: fmtSignedPct(storeMix.same_store_growth),
      unit: "",
      sub: `同店收入 ${fmtWan(storeMix.same_store_current)} 万元`,
      tone: toneOf(storeMix.same_store_growth),
    },
    {
      key: "new_store_share",
      label: "新店收入占比",
      value: newStoreShare,
      display: newStoreShare === null ? "—" : fmtPct(newStoreShare),
      unit: "",
      sub: `新店收入 ${fmtWan(storeMix.new_store_current)} 万元`,
      tone: "flat",
    },
  ];
}
