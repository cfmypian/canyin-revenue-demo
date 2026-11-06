/**
 * 门店排名（对应 Excel「收入区域 / 门店分析」表2 / PPT 第 20 页）。
 *
 * 仅同店参与排名，新店不参与增长额、增长率排名；
 * 三种排名均按数值从高到低降序，rank 从 1 开始。
 *
 * 金额单位：万元；增长率用小数。
 */

import { safeGrowthRate } from "./utils.js";

/**
 * 按取数函数降序排序（null 视为不可比，排在最后；同值保持输入顺序，排序稳定）。
 * @param {Array<object>} rows
 * @param {(row: object) => number|null} getter
 * @returns {Array<object>}
 */
function sortDesc(rows, getter) {
  return [...rows].sort((a, b) => {
    const aValue = getter(a);
    const bValue = getter(b);
    if (aValue === null && bValue === null) return 0;
    if (aValue === null) return 1;
    if (bValue === null) return -1;
    return bValue - aValue;
  });
}

/**
 * 计算门店收入、增长额、增长率三种排名。
 * @param {object} data 收入分析输入数据（顶层含 stores）
 * @returns {{
 *   by_revenue: Array<{store: string, current: number, rank: number}>,
 *   by_growth_amount: Array<{store: string, diff: number, rank: number}>,
 *   by_growth_rate: Array<{store: string, growth_rate: number|null, rank: number}>
 * }}
 */
export function analyzeStoreRank(data) {
  const stores = Array.isArray(data?.stores) ? data.stores : [];
  const sameStores = stores
    .filter((store) => store.type === "同店")
    .map((store) => ({
      store: store.store,
      base: store.base,
      current: store.current,
      diff: store.current - store.base,
      growth_rate: safeGrowthRate(store.current - store.base, store.base),
    }));

  const byRevenue = sortDesc(sameStores, (row) => row.current).map((row, index) => ({
    store: row.store,
    current: row.current,
    rank: index + 1,
  }));

  const byGrowthAmount = sortDesc(sameStores, (row) => row.diff).map((row, index) => ({
    store: row.store,
    diff: row.diff,
    rank: index + 1,
  }));

  const byGrowthRate = sortDesc(sameStores, (row) => row.growth_rate).map((row, index) => ({
    store: row.store,
    growth_rate: row.growth_rate,
    rank: index + 1,
  }));

  return {
    by_revenue: byRevenue,
    by_growth_amount: byGrowthAmount,
    by_growth_rate: byGrowthRate,
  };
}
