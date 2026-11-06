/**
 * 同店 / 新店结构及同店渠道拆解（对应 Excel 收入异动表1、表2 / PPT 第 19、26 页）。
 *
 * 口径说明：
 * - 同店 / 新店按 stores[].type 区分；
 * - 同店折算比例 = 同店门店本期收入合计 / 全部门店本期收入合计
 *   （14 家门店数据下约 0.8570328824），不使用数据里的四舍五入值 same_store_share；
 * - 渠道同店收入 = 渠道本期收入 × 折算比例，
 *   渠道新店收入 = 渠道本期收入 − 渠道同店收入，
 *   渠道同店同比差额 = 渠道同店收入 − 渠道同期收入。
 *
 * 金额单位：万元。
 */

import { safeGrowthRate, sumBy } from "./utils.js";

/**
 * 计算同店 / 新店结构及同店渠道拆解。
 * @param {object} data 收入分析输入数据（顶层含 stores、channels）
 * @returns {{
 *   same_store_base: number,
 *   same_store_current: number,
 *   same_store_diff: number,
 *   same_store_growth: number|null,
 *   new_store_current: number,
 *   total_current: number,
 *   same_store_ratio: number,
 *   channels: Array<{channel: string, same_store: number, diff_vs_base: number, new_store: number}>
 * }}
 */
export function analyzeStoreMix(data) {
  const stores = Array.isArray(data?.stores) ? data.stores : [];
  const channels = Array.isArray(data?.channels) ? data.channels : [];

  const sameStores = stores.filter((store) => store.type === "同店");
  const newStores = stores.filter((store) => store.type === "新店");

  const sameStoreBase = sumBy(sameStores, (store) => store.base);
  const sameStoreCurrent = sumBy(sameStores, (store) => store.current);
  const newStoreCurrent = sumBy(newStores, (store) => store.current);
  const totalCurrent = sumBy(stores, (store) => store.current);
  const sameStoreDiff = sameStoreCurrent - sameStoreBase;

  const sameStoreRatio = totalCurrent === 0 ? 0 : sameStoreCurrent / totalCurrent;

  const channelRows = channels.map((item) => {
    const current = item.current;
    // 用当期收入占比折算同店收入，演示数据口径与 golden 一致
    const sameStore = current * sameStoreRatio;
    return {
      channel: item.channel,
      same_store: sameStore,
      diff_vs_base: sameStore - item.base,
      new_store: current - sameStore,
    };
  });

  return {
    same_store_base: sameStoreBase,
    same_store_current: sameStoreCurrent,
    same_store_diff: sameStoreDiff,
    same_store_growth: safeGrowthRate(sameStoreDiff, sameStoreBase),
    new_store_current: newStoreCurrent,
    total_current: totalCurrent,
    same_store_ratio: sameStoreRatio,
    channels: channelRows,
  };
}
