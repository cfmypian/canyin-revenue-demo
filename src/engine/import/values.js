/**
 * 单元格清洗工具：数值、文本、期间。
 *
 * 上传数据可能来自 Excel（数值、日期对象、序列号）或 CSV（全部是字符串），
 * 这里统一成引擎需要的类型。无法识别时返回 NaN / null，由 validate 报错。
 */

/**
 * 清洗数值：去首尾空格、千分位逗号、全角字符。
 * @param {unknown} value
 * @returns {number} 无法识别时返回 NaN；空值返回 NaN（是否必填由调用方判断）
 */
export function toCleanNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  if (value === null || value === undefined) return Number.NaN;
  const text = String(value)
    .normalize("NFKC")
    .replace(/[\s,]/g, "");
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text)) return Number.NaN;
  return Number(text);
}

/** 清洗文本：去首尾空格（保留中间内容，不改写门店 / 渠道名称）。 */
export function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** Excel 日期序列号 → { year, month }（1900 日期系统）。 */
function fromExcelSerial(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(ms);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/**
 * 期间清洗为 YYYY-MM。
 * 支持 "2025-09" / "2025/9" / "2025.09" / "2025年9月" / Date 对象 / Excel 日期序列号。
 * @param {unknown} value
 * @returns {string|null}
 */
export function toPeriod(value) {
  let year;
  let month;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    year = value.getFullYear();
    month = value.getMonth() + 1;
  } else if (typeof value === "number" && value > 20000 && value < 80000) {
    ({ year, month } = fromExcelSerial(value));
  } else {
    const text = String(value ?? "")
      .normalize("NFKC")
      .trim();
    const matched = text.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*(月)?(\s*[-/.]\s*\d{1,2}\s*日?)?$/);
    if (!matched) return null;
    year = Number(matched[1]);
    month = Number(matched[2]);
  }
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}
