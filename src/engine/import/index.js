/**
 * 数据导入管线入口：解析 → 校验 → 标准化。
 *
 * 输入是 { sheet 名: 二维数组 }（浏览器端由 SheetJS / CSV 解析得到，Node 测试直接构造），
 * 输出可直接交给 analyze(data) 的标准数据集。纯函数，不依赖 DOM / fs。
 */

import { normalize } from "./normalize.js";
import { parseSheets } from "./parse.js";
import { denormalize } from "./template.js";
import { validate } from "./validate.js";

export { parseCSV, toCSV } from "./csv.js";
export { normalizeHeader, parseSheets, sheetNameFromFileName } from "./parse.js";
export { DATA_SHEETS, INTRO_SHEET, SHEET_NAMES, denormalize, headerText } from "./template.js";
export { ISSUE_CODES, TOTAL_MISMATCH_THRESHOLD, formatIssue, validate } from "./validate.js";
export { normalize } from "./normalize.js";

/**
 * 导入一份工作簿。
 * @param {Record<string, unknown[][]>} rawSheets
 * @returns {{
 *   ok: boolean,
 *   data: object|null,
 *   issues: { errors: Array<object>, warnings: Array<object> },
 *   meta: { derived: Array<object>, same_store_ratio: number }|null
 * }}
 */
export function importWorkbook(rawSheets) {
  const parsed = parseSheets(rawSheets ?? {});
  const issues = validate(parsed);
  if (issues.errors.length > 0) {
    return { ok: false, data: null, issues, meta: null };
  }
  const { data, meta } = normalize(parsed);
  return { ok: true, data, issues, meta };
}

/**
 * 校验一份已是标准结构的数据集（例如从浏览器本地存储读回的数据）。
 * 通过「标准结构 → 模板表格 → 重新导入」复用同一套校验规则；结构损坏时返回 ok=false。
 * @param {unknown} data
 * @returns {ReturnType<typeof importWorkbook>}
 */
export function revalidateDataset(data) {
  try {
    if (!data || typeof data !== "object") throw new Error("数据集不是对象");
    return importWorkbook(denormalize(data));
  } catch (error) {
    return {
      ok: false,
      data: null,
      issues: { errors: [{ level: "error", code: "INVALID_DATASET", message: `数据集结构无效：${error?.message ?? error}` }], warnings: [] },
      meta: null,
    };
  }
}
