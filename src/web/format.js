/**
 * 页面共用格式化工具：金额（万元 / 元）、百分比、正负着色。
 *
 * 单位与展示约定（与 design.md 一致）：
 * - 渠道、门店、品类的金额单位是万元，保留 2 位小数；本期合计约 1000 万，
 *   因此万元金额不加千分位（如 "1000.00"），避免和口径说明里的数字对不上；
 * - 门店客流客单表（traffic.stores）原始单位是元，保留整数并加千分位（如 "105,882"）；
 * - 增长率是小数（0.3166 → 31.66%），同期为 0 时引擎返回 null，页面显示 "—"。
 */

const YUAN_FORMATTER = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

/** 转成有限数字，无效值按 0 处理（只用于展示兜底）。 */
export function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/** 万元金额：2 位小数、不加千分位。 */
export function fmtWan(value, digits = 2) {
  const factor = 10 ** digits;
  const rounded = Math.round(toNumber(value) * factor) / factor;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(digits);
}

/** 带符号的万元金额：正数带 "+"，负数带 "-"，0 不带符号。 */
export function fmtSignedWan(value, digits = 2) {
  const factor = 10 ** digits;
  const rounded = Math.round(toNumber(value) * factor) / factor;
  if (rounded === 0) return (0).toFixed(digits);
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}`;
}

/** 元金额：整数、加千分位。 */
export function fmtYuan(value) {
  return YUAN_FORMATTER.format(toNumber(value));
}

/** 带符号的元金额：整数、加千分位（正数带 "+"）。 */
export function fmtSignedYuan(value) {
  const rounded = Math.round(toNumber(value));
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : ""}${YUAN_FORMATTER.format(rounded)}`;
}

/** 元 → 万元（只做单位换算，不格式化）。 */
export function wanFromYuan(value) {
  return toNumber(value) / 10000;
}

/** 占比 / 增长率：0.3166 → "31.66%"；null / 非有限值 → "—"。 */
export function fmtPct(rate, digits = 2) {
  if (rate === null || rate === undefined) return "—";
  const num = Number(rate);
  if (!Number.isFinite(num)) return "—";
  return `${(num * 100).toFixed(digits)}%`;
}

/** 带符号的增长率：0.128 → "+12.80%"；null → "—"。 */
export function fmtSignedPct(rate, digits = 2) {
  if (rate === null || rate === undefined) return "—";
  const num = Number(rate);
  if (!Number.isFinite(num)) return "—";
  const factor = 10 ** digits;
  const rounded = Math.round(num * 100 * factor) / factor;
  if (rounded === 0) return `${(0).toFixed(digits)}%`;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}%`;
}

/** 正负着色 class：pos / neg / flat。 */
export function toneOf(value) {
  const num = toNumber(value);
  if (num > 0) return "pos";
  if (num < 0) return "neg";
  return "flat";
}

/** HTML 转义（引擎输出虽然是内部数据，仍统一转义）。 */
export function htmlEsc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}
