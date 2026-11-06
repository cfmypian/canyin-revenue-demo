/**
 * 上传数据校验：结构、类型、取值、主键、跨表一致性。
 *
 * 问题分两级：
 * - error：阻断导入；
 * - warning：提示后可继续导入。
 *
 * 每个问题 { level, code, sheet, row, column, message, rows? }，
 * code 是固定枚举（测试按 code 断言），message 是给用户看的中文原因。
 */

import { isBlank } from "./parse.js";
import { DATA_SHEETS, INTRO_SHEET, PERIOD_LABELS } from "./template.js";
import { cleanText, toCleanNumber, toPeriod } from "./values.js";

/** 问题代码枚举。 */
export const ISSUE_CODES = Object.freeze({
  MISSING_SHEET: "MISSING_SHEET",
  MISSING_COLUMN: "MISSING_COLUMN",
  EMPTY_SHEET: "EMPTY_SHEET",
  MISSING_PERIOD: "MISSING_PERIOD",
  INVALID_PERIOD: "INVALID_PERIOD",
  REQUIRED: "REQUIRED",
  NOT_NUMBER: "NOT_NUMBER",
  NEGATIVE: "NEGATIVE",
  INVALID_ENUM: "INVALID_ENUM",
  DUPLICATE_KEY: "DUPLICATE_KEY",
  UNKNOWN_STORE: "UNKNOWN_STORE",
  TRAFFIC_NOT_SAME_STORE: "TRAFFIC_NOT_SAME_STORE",
  NO_SAME_STORE: "NO_SAME_STORE",
  // 以下为警告
  TOTAL_MISMATCH: "TOTAL_MISMATCH",
  ZERO_BASE: "ZERO_BASE",
  SAME_STORE_NO_TRAFFIC: "SAME_STORE_NO_TRAFFIC",
  PERIOD_ORDER: "PERIOD_ORDER",
});

/** 渠道合计与门店合计允许的相对差异。 */
export const TOTAL_MISMATCH_THRESHOLD = 0.01;

/**
 * 问题 → 一行可读文本：「渠道 · 第 5 行 · 本期收入：不是数字」。
 * @param {object} issue
 * @returns {string}
 */
export function formatIssue(issue) {
  const parts = [];
  if (issue.sheet) parts.push(issue.sheet);
  if (issue.row) parts.push(`第 ${issue.row} 行`);
  if (issue.column) parts.push(issue.column);
  return parts.length ? `${parts.join(" · ")}：${issue.message}` : issue.message;
}

/** 问题收集器。 */
function createCollector() {
  const errors = [];
  const warnings = [];
  return {
    errors,
    warnings,
    error(issue) {
      errors.push({ level: "error", ...issue });
    },
    warn(issue) {
      warnings.push({ level: "warning", ...issue });
    },
  };
}

/** 校验期间。 */
function checkPeriod(parsed, out) {
  if (!parsed.introFound) {
    out.error({ code: ISSUE_CODES.MISSING_SHEET, sheet: INTRO_SHEET, message: `缺少 sheet：${INTRO_SHEET}` });
    return;
  }
  const periods = {};
  for (const [key, label] of Object.entries(PERIOD_LABELS)) {
    const raw = parsed.period[key];
    const row = parsed.period.rows[key];
    if (isBlank(raw)) {
      out.error({ code: ISSUE_CODES.MISSING_PERIOD, sheet: INTRO_SHEET, row, column: label, message: "未填写，格式为 YYYY-MM" });
      continue;
    }
    const value = toPeriod(raw);
    if (!value) {
      out.error({
        code: ISSUE_CODES.INVALID_PERIOD,
        sheet: INTRO_SHEET,
        row,
        column: label,
        message: `「${cleanText(raw)}」不是有效月份，格式为 YYYY-MM`,
      });
      continue;
    }
    periods[key] = value;
  }
  if (periods.base && periods.current && periods.base >= periods.current) {
    out.warn({
      code: ISSUE_CODES.PERIOD_ORDER,
      sheet: INTRO_SHEET,
      message: `同期月份（${periods.base}）不早于本期月份（${periods.current}），请确认是否填反`,
    });
  }
}

/**
 * 校验单张表的单元格，并返回清洗后的行（只含通过校验的字段，用于后续跨表检查）。
 */
function checkSheet(sheet, parsedSheet, out) {
  if (!parsedSheet.found) {
    out.error({ code: ISSUE_CODES.MISSING_SHEET, sheet: sheet.name, message: `缺少 sheet：${sheet.name}` });
    return null;
  }
  const missingRequired = parsedSheet.missingColumns.filter((column) => column.required);
  for (const column of missingRequired) {
    out.error({ code: ISSUE_CODES.MISSING_COLUMN, sheet: sheet.name, column: column.label, message: `缺少列：${column.label}` });
  }
  if (missingRequired.length > 0) return null;
  if (parsedSheet.rows.length === 0) {
    out.error({ code: ISSUE_CODES.EMPTY_SHEET, sheet: sheet.name, message: "没有数据行" });
    return null;
  }

  const cleanRows = [];
  for (const { row, values } of parsedSheet.rows) {
    const clean = { row };
    for (const column of sheet.columns) {
      const raw = values[column.key];
      if (isBlank(raw)) {
        if (column.required) {
          out.error({ code: ISSUE_CODES.REQUIRED, sheet: sheet.name, row, column: column.label, message: "必填，不能为空" });
        }
        continue;
      }
      if (column.type === "number") {
        const num = toCleanNumber(raw);
        if (Number.isNaN(num)) {
          out.error({ code: ISSUE_CODES.NOT_NUMBER, sheet: sheet.name, row, column: column.label, message: `「${cleanText(raw)}」不是数字` });
        } else if (num < 0) {
          out.error({ code: ISSUE_CODES.NEGATIVE, sheet: sheet.name, row, column: column.label, message: `不能为负数（${num}）` });
        } else {
          clean[column.key] = num;
        }
      } else if (column.type === "enum") {
        const text = cleanText(raw);
        if (!column.enum.includes(text)) {
          out.error({
            code: ISSUE_CODES.INVALID_ENUM,
            sheet: sheet.name,
            row,
            column: column.label,
            message: `「${text}」无效，只能填 ${column.enum.join(" / ")}`,
          });
        } else {
          clean[column.key] = text;
        }
      } else {
        clean[column.key] = cleanText(raw);
      }
    }
    cleanRows.push(clean);
  }

  // 主键重复：列出所有出现的行号
  const keyColumn = sheet.columns.find((column) => column.key === sheet.primaryKey);
  const seen = new Map();
  for (const clean of cleanRows) {
    const key = clean[sheet.primaryKey];
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(clean.row);
  }
  for (const [key, rows] of seen) {
    if (rows.length > 1) {
      out.error({
        code: ISSUE_CODES.DUPLICATE_KEY,
        sheet: sheet.name,
        row: rows[1],
        rows,
        column: keyColumn.label,
        message: `${keyColumn.label}「${key}」重复（第 ${rows.join("、")} 行）`,
      });
    }
  }
  return cleanRows;
}

/** 同期为 0 的提示（新店同期为 0 属正常，不提示）。 */
function warnZeroBase(sheetName, rows, keyField, baseField, out, skip = () => false) {
  for (const clean of rows) {
    if (clean[baseField] === 0 && !skip(clean)) {
      out.warn({
        code: ISSUE_CODES.ZERO_BASE,
        sheet: sheetName,
        row: clean.row,
        message: `「${clean[keyField]}」同期为 0，增减率将显示为空`,
      });
    }
  }
}

/** 跨表一致性与口径提示。 */
function checkCrossSheet(clean, out) {
  const { channels, stores, categories, store_traffic: traffic } = clean;

  if (stores) {
    if (!stores.some((store) => store.type === "同店")) {
      out.error({ code: ISSUE_CODES.NO_SAME_STORE, sheet: "门店", message: "至少需要一家「同店」门店，否则无法计算同店口径" });
    }
    warnZeroBase("门店", stores, "store", "base", out, (store) => store.type === "新店");
  }
  if (channels) warnZeroBase("渠道", channels, "channel", "base", out);
  if (categories) warnZeroBase("品类", categories, "category", "base_revenue", out);

  if (stores && traffic) {
    const storeType = new Map(stores.map((store) => [store.store, store.type]));
    for (const item of traffic) {
      if (!item.store) continue;
      if (!storeType.has(item.store)) {
        out.error({
          code: ISSUE_CODES.UNKNOWN_STORE,
          sheet: "门店客流",
          row: item.row,
          column: "门店",
          message: `「${item.store}」不在「门店」sheet 中`,
        });
      } else if (storeType.get(item.store) !== "同店") {
        out.error({
          code: ISSUE_CODES.TRAFFIC_NOT_SAME_STORE,
          sheet: "门店客流",
          row: item.row,
          column: "门店",
          message: `「${item.store}」不是同店，门店客流表只填同店门店`,
        });
      }
    }
    const trafficStores = new Set(traffic.map((item) => item.store));
    for (const store of stores) {
      if (store.type === "同店" && store.store && !trafficStores.has(store.store)) {
        out.warn({
          code: ISSUE_CODES.SAME_STORE_NO_TRAFFIC,
          sheet: "门店客流",
          message: `同店「${store.store}」没有客流数据，客流分析将不包含该门店`,
        });
      }
    }
  }

  if (channels && stores) {
    const channelTotal = channels.reduce((sum, item) => sum + (item.current ?? 0), 0);
    const storeTotal = stores.reduce((sum, item) => sum + (item.current ?? 0), 0);
    const denominator = Math.max(Math.abs(storeTotal), Math.abs(channelTotal));
    if (denominator > 0 && Math.abs(channelTotal - storeTotal) / denominator > TOTAL_MISMATCH_THRESHOLD) {
      out.warn({
        code: ISSUE_CODES.TOTAL_MISMATCH,
        message: `渠道合计与门店合计不一致：渠道本期合计 ${channelTotal.toFixed(2)} 万元，门店本期合计 ${storeTotal.toFixed(2)} 万元`,
      });
    }
  }
}

/**
 * 校验解析结果。
 * @param {ReturnType<import("./parse.js").parseSheets>} parsed
 * @returns {{ errors: Array<object>, warnings: Array<object> }}
 */
export function validate(parsed) {
  const out = createCollector();
  checkPeriod(parsed, out);
  const clean = {};
  for (const sheet of DATA_SHEETS) {
    clean[sheet.id] = checkSheet(sheet, parsed.sheets[sheet.id], out);
  }
  checkCrossSheet(clean, out);
  return { errors: out.errors, warnings: out.warnings };
}
