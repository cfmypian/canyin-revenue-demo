/**
 * 标准化：把通过校验的解析结果转换为与 data/revenue_2025-09.json 相同的标准结构。
 *
 * - 文本去首尾空格，数值去千分位、统一为 number；
 * - same_store_share = 同店门店本期收入 / 全部门店本期收入（与引擎 store_mix 同口径，保留 3 位）；
 * - 品类「本期同店销量」为空时按同店收入占比折算（本期销量 × 占比，未四舍五入的比例），
 *   并记入 meta.derived，看板和报告据此标注折算口径。
 *
 * 只应在 validate 无错误时调用。
 */

import { cleanText, toCleanNumber, toPeriod } from "./values.js";
import { isBlank } from "./parse.js";

const num = (value) => toCleanNumber(value);

/**
 * @param {ReturnType<import("./parse.js").parseSheets>} parsed
 * @returns {{ data: object, meta: { derived: Array<{ field: string, sheet: string, items: string[] }>, same_store_ratio: number } }}
 */
export function normalize(parsed) {
  const rowsOf = (id) => parsed.sheets[id]?.rows ?? [];

  const channels = rowsOf("channels").map(({ values }) => ({
    channel: cleanText(values.channel),
    base: num(values.base),
    current: num(values.current),
  }));

  const stores = rowsOf("stores").map(({ values }) => ({
    region: cleanText(values.region),
    store: cleanText(values.store),
    type: cleanText(values.type),
    base: num(values.base),
    current: num(values.current),
  }));

  const sameStoreCurrent = stores.filter((store) => store.type === "同店").reduce((sum, store) => sum + store.current, 0);
  const totalCurrent = stores.reduce((sum, store) => sum + store.current, 0);
  const ratio = totalCurrent === 0 ? 0 : sameStoreCurrent / totalCurrent;

  const derivedCategories = [];
  const categories = rowsOf("categories").map(({ values }) => {
    const category = cleanText(values.category);
    const currentQty = num(values.current_qty);
    let sameStoreQty;
    if (isBlank(values.same_store_current_qty)) {
      sameStoreQty = currentQty * ratio;
      derivedCategories.push(category);
    } else {
      sameStoreQty = num(values.same_store_current_qty);
    }
    return {
      category,
      base: { qty: num(values.base_qty), revenue: num(values.base_revenue) },
      current: { qty: currentQty, revenue: num(values.current_revenue) },
      same_store_current_qty: sameStoreQty,
    };
  });

  const storeTraffic = rowsOf("store_traffic").map(({ values }) => ({
    store: cleanText(values.store),
    current: { traffic: num(values.current_traffic), ticket: num(values.current_ticket) },
    base: { traffic: num(values.base_traffic), ticket: num(values.base_ticket) },
  }));

  const derived = [];
  if (derivedCategories.length > 0) {
    derived.push({ field: "same_store_current_qty", sheet: "品类", items: derivedCategories });
  }

  return {
    data: {
      period: { base: toPeriod(parsed.period.base), current: toPeriod(parsed.period.current) },
      same_store_share: Math.round(ratio * 1000) / 1000,
      channels,
      stores,
      categories,
      store_traffic: storeTraffic,
    },
    meta: { derived, same_store_ratio: ratio },
  };
}
