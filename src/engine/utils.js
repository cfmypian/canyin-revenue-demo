/**
 * 引擎内部共享的数值小工具。
 *
 * 只做数值安全处理，不依赖 fs / process / DOM / 第三方库，
 * 因此浏览器和 Node 测试可以共用同一份实现。
 */

/** 转成有限数字，无效值（null / undefined / NaN / Infinity）按 0 处理。 */
export function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 按取数函数对数组求和，空数组或无效值安全返回 0。 */
export function sumBy(items, getter) {
  const list = Array.isArray(items) ? items : [];
  return list.reduce((total, item, index) => total + toNumber(getter(item, index)), 0);
}

/**
 * 增减率 = 差额 / 同期。
 * 同期为 0（或非有限值）时返回 null，避免出现 0 / Infinity。
 */
export function safeGrowthRate(diff, base) {
  const baseValue = toNumber(base);
  if (baseValue === 0) return null;
  return toNumber(diff) / baseValue;
}

/** 占比 = 部分 / 合计；合计为 0 时返回 null。 */
export function safeShare(part, total) {
  const totalValue = toNumber(total);
  if (totalValue === 0) return null;
  return toNumber(part) / totalValue;
}

/** 单价 = 金额 / 数量；数量为 0 时返回 0，避免 Infinity。 */
export function safeUnitPrice(revenue, qty) {
  const qtyValue = toNumber(qty);
  if (qtyValue === 0) return 0;
  return toNumber(revenue) / qtyValue;
}
