/**
 * 品类量价因素分析（对应 Excel 收入异动表3 / PPT 第 29 页）。
 *
 * 连环替代法固定顺序：先换量、再换价。
 * - 销量影响 = (本期销量 − 同期销量) × 同期单价
 * - 单价影响 = (本期单价 − 同期单价) × 本期销量
 * - 两因素之和 = 本期收入 − 同期收入（浮点误差 < 0.01）
 *
 * 两套口径：
 * - all（全店）：本期收入 / 销量用当前值；
 * - same_store（同店）：本期收入 = 品类本期收入 × 同店折算比例，
 *   本期同店销量用 data.categories[].same_store_current_qty；
 *   同期收入 / 销量用 base。
 *
 * 金额单位：万元；销量单位：份。两套口径末尾都追加一条「合计」行。
 */

import { safeUnitPrice, sumBy } from "./utils.js";

/**
 * 按给定口径生成各品类的量价因素行。
 * @param {Array<object>} categories 品类数组
 * @param {(category: object) => {base: {qty: number, revenue: number}, current: {qty: number, revenue: number}}} select 口径取数
 * @returns {Array<{category: string, qty_effect: number, price_effect: number, total: number}>}
 */
function buildRows(categories, select) {
  return categories.map((category) => {
    const { base, current } = select(category);
    const basePrice = safeUnitPrice(base.revenue, base.qty);
    const currentPrice = safeUnitPrice(current.revenue, current.qty);
    return {
      category: category.category,
      qty_effect: (current.qty - base.qty) * basePrice,
      price_effect: (currentPrice - basePrice) * current.qty,
      total: current.revenue - base.revenue,
    };
  });
}

/**
 * 追加「合计」行：各列分别纵向求和。
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
function withTotalRow(rows) {
  return [
    ...rows,
    {
      category: "合计",
      qty_effect: sumBy(rows, (row) => row.qty_effect),
      price_effect: sumBy(rows, (row) => row.price_effect),
      total: sumBy(rows, (row) => row.total),
    },
  ];
}

/**
 * 计算品类量价因素分析（全店 / 同店两套口径）。
 * @param {object} data 收入分析输入数据（顶层含 categories）
 * @param {number} sameStoreRatio 同店折算比例（同店门店本期收入 / 全部门店本期收入）
 * @returns {{
 *   all: Array<{category: string, qty_effect: number, price_effect: number, total: number}>,
 *   same_store: Array<{category: string, qty_effect: number, price_effect: number, total: number}>
 * }}
 */
export function analyzeCategoryQtyPrice(data, sameStoreRatio) {
  const categories = Array.isArray(data?.categories) ? data.categories : [];
  const ratio = Number.isFinite(sameStoreRatio) ? sameStoreRatio : 0;

  const allRows = buildRows(categories, (category) => ({
    base: {
      qty: category.base?.qty,
      revenue: category.base?.revenue,
    },
    current: {
      qty: category.current?.qty,
      revenue: category.current?.revenue,
    },
  }));

  const sameStoreRows = buildRows(categories, (category) => ({
    base: {
      qty: category.base?.qty,
      revenue: category.base?.revenue,
    },
    current: {
      // 演示数据口径：同店本期收入按同店收入占比折算
      qty: category.same_store_current_qty,
      revenue: (category.current?.revenue ?? 0) * ratio,
    },
  }));

  return {
    all: withTotalRow(allRows),
    same_store: withTotalRow(sameStoreRows),
  };
}
