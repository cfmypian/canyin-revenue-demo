/**
 * 收入分析计算引擎统一入口。
 *
 * 纯函数 ES Module，浏览器与 Node 测试共用同一份代码：
 * - 不依赖 fs / process / DOM / 第三方库；
 * - 不修改传入的 data，每次调用返回全新对象。
 *
 * 五层分析：
 * 1. channel            渠道收入结构
 * 2. store_mix          同店 / 新店结构及同店渠道拆解
 * 3. store_rank         门店收入、增长额、增长率三种排名
 * 4. category_qty_price 品类量价因素（全店 / 同店两套口径）
 * 5. traffic            同店品类三因素 + 门店客流客单两因素
 *
 * 另附 insights：每一层的一句话结论（规则化，不调大模型）。
 */

import { analyzeCategoryQtyPrice } from "./categoryFactor.js";
import { analyzeChannel } from "./channel.js";
import { buildInsights } from "./insights.js";
import { analyzeStoreMix } from "./storeMix.js";
import { analyzeStoreRank } from "./storeRank.js";
import { analyzeTraffic } from "./trafficFactor.js";

/**
 * 执行收入分析。
 * @param {object} data 收入分析输入数据（data/revenue_2025-09.json 的结构）
 * @returns {{
 *   channel: object,
 *   store_mix: object,
 *   store_rank: object,
 *   category_qty_price: object,
 *   traffic: object,
 *   insights: object
 * }}
 */
export function analyze(data) {
  const channel = analyzeChannel(data);
  const storeMix = analyzeStoreMix(data);
  const storeRank = analyzeStoreRank(data);

  // 同店折算比例由门店口径推导（同店门店本期收入 / 全部门店本期收入），
  // 不直接使用数据里的四舍五入值 same_store_share。
  const sameStoreRatio = storeMix.same_store_ratio ?? 0;

  const categoryQtyPrice = analyzeCategoryQtyPrice(data, sameStoreRatio);
  const traffic = analyzeTraffic(data, sameStoreRatio);

  const insights = buildInsights({
    data,
    channel,
    store_mix: storeMix,
    store_rank: storeRank,
    category_qty_price: categoryQtyPrice,
    traffic,
  });

  return {
    channel,
    store_mix: storeMix,
    store_rank: storeRank,
    category_qty_price: categoryQtyPrice,
    traffic,
    insights,
  };
}

export default analyze;
