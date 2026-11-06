/**
 * 渠道收入结构（对应 Excel「收入渠道分析」/ PPT 第 24-25 页）。
 *
 * 输出字段：
 * - rows：每个渠道的 base（同期）、current（本期）、share（本期占比）、
 *   diff（同比差额）、growth_rate（增减率，同期为 0 时为 null）
 * - base_total / current_total / diff / growth_rate：合计口径
 *
 * 金额单位：万元。
 */

import { safeGrowthRate, safeShare, sumBy } from "./utils.js";

/**
 * 计算渠道收入结构。
 * @param {object} data 收入分析输入数据（顶层含 channels）
 * @returns {{rows: Array<object>, base_total: number, current_total: number, diff: number, growth_rate: number|null}}
 */
export function analyzeChannel(data) {
  const channels = Array.isArray(data?.channels) ? data.channels : [];

  const baseTotal = sumBy(channels, (item) => item.base);
  const currentTotal = sumBy(channels, (item) => item.current);
  const diff = currentTotal - baseTotal;

  const rows = channels.map((item) => {
    const base = item.base;
    const current = item.current;
    const rowDiff = current - base;
    return {
      channel: item.channel,
      base,
      current,
      share: safeShare(current, currentTotal),
      diff: rowDiff,
      growth_rate: safeGrowthRate(rowDiff, base),
    };
  });

  return {
    rows,
    base_total: baseTotal,
    current_total: currentTotal,
    diff,
    growth_rate: safeGrowthRate(diff, baseTotal),
  };
}
