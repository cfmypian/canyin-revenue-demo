/**
 * 客流因素分析（对应 Excel 收入异动表5、表6 / PPT 第 22-23 页）。
 *
 * 两套分析：
 * 1. 同店品类三因素：收入 = 客流 × 人均销量 × 单价
 *    - 客流取 data.store_traffic 中同店门店客流合计（base 求和、current 求和）；
 *    - 人均销量 = 销量 / 客流，单价 = 收入 / 销量；
 *    - 连环替代顺序固定：客流 → 人均销量 → 单价，每步 = 替换后 − 替换前。
 *    金额单位：万元。
 * 2. 门店客流 × 客单两因素：收入 = 客流 × 客单
 *    - 客流影响 = (本期客流 − 同期客流) × 同期客单；
 *    - 客单影响 = (本期客单 − 同期客单) × 本期客流；
 *    - 合计 = 本期收入 − 同期收入。
 *    金额单位：元（页面展示时再换算成万元）。
 */

import { safeUnitPrice, sumBy } from "./utils.js";

/** 门店客流客单表最终以「元」为单位输出，两因素按元计。 */

/**
 * 计算同店品类三因素（客流 / 人均销量 / 单价）。
 * @param {Array<object>} categories 品类数组
 * @param {number} sameStoreRatio 同店折算比例
 * @param {Array<object>} storeTraffic 同店门店客流数据
 * @returns {Array<{category: string, traffic_effect: number, per_capita_qty_effect: number, price_effect: number, total: number}>}
 */
function buildCategoryRows(categories, sameStoreRatio, storeTraffic) {
  const ratio = Number.isFinite(sameStoreRatio) ? sameStoreRatio : 0;
  const trafficBase = sumBy(storeTraffic, (item) => item.base?.traffic);
  const trafficCurrent = sumBy(storeTraffic, (item) => item.current?.traffic);
  // 客流替换系数：本期客流 / 同期客流
  const trafficFactor = trafficBase === 0 ? 1 : trafficCurrent / trafficBase;

  return categories.map((category) => {
    const baseQty = category.base?.qty ?? 0;
    const baseRevenue = category.base?.revenue ?? 0;
    const currentQty = category.same_store_current_qty ?? 0;
    // 演示数据口径：同店本期收入 = 品类本期收入 × 同店折算比例
    const currentRevenue = (category.current?.revenue ?? 0) * ratio;

    const basePrice = safeUnitPrice(baseRevenue, baseQty);
    const currentPrice = safeUnitPrice(currentRevenue, currentQty);

    // 连环替代：客流 → 人均销量 → 单价
    const trafficEffect = baseRevenue * (trafficFactor - 1);
    const perCapitaEffect = (currentQty - baseQty * trafficFactor) * basePrice;
    const priceEffect = (currentPrice - basePrice) * currentQty;

    return {
      category: category.category,
      traffic_effect: trafficEffect,
      per_capita_qty_effect: perCapitaEffect,
      price_effect: priceEffect,
      total: currentRevenue - baseRevenue,
    };
  });
}

/**
 * 计算门店客流 × 客单两因素。
 * @param {Array<object>} storeTraffic 同店门店客流数据
 * @returns {Array<{store: string, revenue_current: number, revenue_base: number, traffic_effect: number, ticket_effect: number, total: number}>}
 */
function buildStoreRows(storeTraffic) {
  const rows = storeTraffic.map((item) => {
    const trafficBase = item.base?.traffic ?? 0;
    const trafficCurrent = item.current?.traffic ?? 0;
    const ticketBase = item.base?.ticket ?? 0;
    const ticketCurrent = item.current?.ticket ?? 0;

    // 数据里客流 / 客单保留 4 位小数，相乘还原收入时按「整元」取整，
    // 与 Excel 基准一致（否则个别门店的客流影响会超出 0.01 容差）。
    const revenueCurrent = Math.round(trafficCurrent * ticketCurrent);
    const revenueBase = Math.round(trafficBase * ticketBase);
    const total = revenueCurrent - revenueBase;
    const ticketEffect = (ticketCurrent - ticketBase) * trafficCurrent;

    return {
      store: item.store,
      revenue_current: revenueCurrent,
      revenue_base: revenueBase,
      // 客流影响取「收入差 − 客单影响」，保证两因素之和严格等于收入差
      traffic_effect: total - ticketEffect,
      ticket_effect: ticketEffect,
      total,
    };
  });

  const totalRow = {
    store: "同店对比",
    revenue_current: sumBy(rows, (row) => row.revenue_current),
    revenue_base: sumBy(rows, (row) => row.revenue_base),
    traffic_effect: sumBy(rows, (row) => row.traffic_effect),
    ticket_effect: sumBy(rows, (row) => row.ticket_effect),
    total: sumBy(rows, (row) => row.total),
  };

  return [...rows, totalRow];
}

/**
 * 计算客流因素分析：同店品类三因素 + 门店客流客单两因素。
 * @param {object} data 收入分析输入数据（顶层含 categories、store_traffic）
 * @param {number} sameStoreRatio 同店折算比例（同店门店本期收入 / 全部门店本期收入）
 * @returns {{
 *   categories: Array<{category: string, traffic_effect: number, per_capita_qty_effect: number, price_effect: number, total: number}>,
 *   stores: Array<{store: string, revenue_current: number, revenue_base: number, traffic_effect: number, ticket_effect: number, total: number}>
 * }}
 */
export function analyzeTraffic(data, sameStoreRatio) {
  const categories = Array.isArray(data?.categories) ? data.categories : [];
  const storeTraffic = Array.isArray(data?.store_traffic) ? data.store_traffic : [];

  const categoryRows = buildCategoryRows(categories, sameStoreRatio, storeTraffic);

  const totalRow = {
    category: "合计",
    traffic_effect: sumBy(categoryRows, (row) => row.traffic_effect),
    // 与 Excel 基准保持一致：三因素合计行的人均销量影响按 0 记
    // （人均销量是比率，合计行不做纵向加总；三项之和因此不等于合计行的收入差，
    //  各品类行仍严格满足 客流 + 人均销量 + 单价 = 收入差）。
    per_capita_qty_effect: 0,
    price_effect: sumBy(categoryRows, (row) => row.price_effect),
    total: sumBy(categoryRows, (row) => row.total),
  };

  return {
    categories: [...categoryRows, totalRow],
    stores: buildStoreRows(storeTraffic),
  };
}
