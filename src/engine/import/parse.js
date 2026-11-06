/**
 * 上传数据解析：{ sheet 名: 二维数组 } → 按列定义映射后的行对象（保留原始行号）。
 *
 * - 表头按 label 匹配，不依赖列顺序；匹配前做归一化（全角转半角、去空格、去单位后缀），
 *   因此「同期收入（万元）」「同期收入(万元)」「 同期收入 」都能识别；
 * - 行号与表格软件一致：表头是第 1 行，数据从第 2 行开始；整行为空的行跳过；
 * - 只做结构映射，不做类型转换（交给 validate / normalize）。
 */

import { DATA_SHEETS, INTRO_SHEET, PERIOD_LABELS, SHEET_NAMES } from "./template.js";

/** 文本归一化：NFKC（全角转半角）+ 去所有空白。 */
function compact(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "");
}

/** 表头归一化：去掉末尾的单位括号，例如「同期收入(万元)」→「同期收入」。 */
export function normalizeHeader(value) {
  return compact(value).replace(/\([^()]*\)$/, "");
}

/** 单元格是否为空。 */
export function isBlank(value) {
  return value === null || value === undefined || compact(value) === "";
}

/**
 * 按 sheet 名查找原始数据（sheet 名同样归一化后比较）。
 * @param {Record<string, unknown[][]>} rawSheets
 * @param {string} name
 */
function findSheet(rawSheets, name) {
  const target = compact(name);
  const key = Object.keys(rawSheets ?? {}).find((sheetName) => compact(sheetName) === target);
  return key === undefined ? null : rawSheets[key];
}

/**
 * 上传 CSV 时由文件名推断 sheet 名：「收入分析数据模板-门店客流.csv」→「门店客流」。
 * 按 sheet 名长度倒序匹配结尾，避免「门店客流」被识别成「门店」。
 * @param {string} fileName
 * @returns {string|null}
 */
export function sheetNameFromFileName(fileName) {
  const stem = compact(fileName).replace(/\.[^.]*$/, "");
  const candidates = [...SHEET_NAMES].sort((a, b) => b.length - a.length);
  return candidates.find((name) => stem.endsWith(compact(name))) ?? null;
}

/** 读取「说明」sheet 中的期间（第一列为标签，第二列为值）。 */
function parsePeriod(rows) {
  const period = { base: null, current: null, rows: {} };
  if (!Array.isArray(rows)) return period;
  rows.forEach((row, index) => {
    const label = compact(Array.isArray(row) ? row[0] : "");
    for (const [key, text] of Object.entries(PERIOD_LABELS)) {
      if (label === compact(text)) {
        period[key] = Array.isArray(row) ? row[1] ?? null : null;
        period.rows[key] = index + 1;
      }
    }
  });
  return period;
}

/**
 * 解析单张数据表。
 * @returns {{ name: string, found: boolean, missingColumns: Array<object>, rows: Array<{ row: number, values: Record<string, unknown> }> }}
 */
function parseDataSheet(rawSheets, sheet) {
  const rows = findSheet(rawSheets, sheet.name);
  const result = { name: sheet.name, found: Array.isArray(rows), missingColumns: [], rows: [] };
  if (!result.found) return result;

  // 第一个非空行视为表头
  const headerIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => !isBlank(cell)));
  if (headerIndex < 0) return result;

  const header = rows[headerIndex].map(normalizeHeader);
  const columnIndex = {};
  for (const column of sheet.columns) {
    const index = header.indexOf(compact(column.label));
    if (index >= 0) {
      columnIndex[column.key] = index;
    } else {
      result.missingColumns.push(column);
    }
  }

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    if (!row.some((cell) => !isBlank(cell))) continue;
    const values = {};
    for (const [key, index] of Object.entries(columnIndex)) {
      values[key] = row[index];
    }
    result.rows.push({ row: i + 1, values });
  }
  return result;
}

/**
 * 解析整份上传数据。
 * @param {Record<string, unknown[][]>} rawSheets { sheet 名: 二维数组 }
 * @returns {{
 *   introFound: boolean,
 *   period: { base: unknown, current: unknown, rows: Record<string, number> },
 *   sheets: Record<string, ReturnType<typeof parseDataSheet>>
 * }}
 */
export function parseSheets(rawSheets) {
  const intro = findSheet(rawSheets, INTRO_SHEET);
  const sheets = {};
  for (const sheet of DATA_SHEETS) {
    sheets[sheet.id] = parseDataSheet(rawSheets, sheet);
  }
  return {
    introFound: Array.isArray(intro),
    period: parsePeriod(intro),
    sheets,
  };
}
