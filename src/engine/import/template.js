/**
 * 数据上传模板定义（单一来源）。
 *
 * 同一份列定义同时驱动：
 * - 模板生成（denormalize：标准结构 → 各 sheet 二维数组）；
 * - 上传解析与校验（parse / validate 按 label 匹配表头）。
 *
 * 对应课程 Excel 输入区：
 * - 渠道      ← 第二步-餐饮收入结构分析 · 表1-收入渠道分析
 * - 门店      ← 第二步-餐饮收入结构分析 · 表2-收入区域/门店分析
 * - 品类      ← 第二步-收入异动分析 · 表3 品类量价
 * - 门店客流  ← 第二步-收入异动分析 · 表6 门店客流 × 客单
 *
 * 纯数据 + 纯函数，不依赖 DOM / fs。
 */

/** 「说明」sheet 名与期间字段标签。 */
export const INTRO_SHEET = "说明";
export const PERIOD_LABELS = { base: "同期月份", current: "本期月份" };

/** 门店类型枚举。 */
export const STORE_TYPES = ["同店", "新店"];

/**
 * 数据 sheet 定义。
 * column: { key, label, unit?, type: "text" | "number" | "enum", required, enum? }
 * primaryKey: 主键列 key（不允许重复）
 */
export const DATA_SHEETS = [
  {
    id: "channels",
    name: "渠道",
    primaryKey: "channel",
    columns: [
      { key: "channel", label: "渠道", type: "text", required: true },
      { key: "base", label: "同期收入", unit: "万元", type: "number", required: true },
      { key: "current", label: "本期收入", unit: "万元", type: "number", required: true },
    ],
  },
  {
    id: "stores",
    name: "门店",
    primaryKey: "store",
    columns: [
      { key: "region", label: "区域", type: "text", required: true },
      { key: "store", label: "门店", type: "text", required: true },
      { key: "type", label: "门店类型", type: "enum", enum: STORE_TYPES, required: true },
      { key: "base", label: "同期收入", unit: "万元", type: "number", required: true },
      { key: "current", label: "本期收入", unit: "万元", type: "number", required: true },
    ],
  },
  {
    id: "categories",
    name: "品类",
    primaryKey: "category",
    columns: [
      { key: "category", label: "品类", type: "text", required: true },
      { key: "base_qty", label: "同期销量", unit: "份", type: "number", required: true },
      { key: "base_revenue", label: "同期收入", unit: "万元", type: "number", required: true },
      { key: "current_qty", label: "本期销量", unit: "份", type: "number", required: true },
      { key: "current_revenue", label: "本期收入", unit: "万元", type: "number", required: true },
      // 可选：不填时按同店收入占比折算
      { key: "same_store_current_qty", label: "本期同店销量", unit: "份", type: "number", required: false },
    ],
  },
  {
    id: "store_traffic",
    name: "门店客流",
    primaryKey: "store",
    columns: [
      { key: "store", label: "门店", type: "text", required: true },
      { key: "base_traffic", label: "同期客流", unit: "人次", type: "number", required: true },
      { key: "base_ticket", label: "同期客单", unit: "元", type: "number", required: true },
      { key: "current_traffic", label: "本期客流", unit: "人次", type: "number", required: true },
      { key: "current_ticket", label: "本期客单", unit: "元", type: "number", required: true },
    ],
  },
];

/** 所有 sheet 名（说明 + 4 张数据表），即模板的 sheet 顺序。 */
export const SHEET_NAMES = [INTRO_SHEET, ...DATA_SHEETS.map((sheet) => sheet.name)];

/** 表头显示文本：「同期收入（万元）」。 */
export function headerText(column) {
  return column.unit ? `${column.label}（${column.unit}）` : column.label;
}

/** 「说明」sheet 的说明文字行（期间行之后追加）。 */
const INTRO_NOTES = [
  ["填写说明", ""],
  ["1", "请勿修改 sheet 名称和表头文字；列顺序可以调整，多余的列会被忽略。"],
  ["2", "期间格式为 YYYY-MM，例如 2025-09；同期为对比月份（通常是去年同月）。"],
  ["3", "渠道、门店、品类的收入单位为万元；品类销量单位为份。"],
  ["4", "门店客流表：客流单位为人次，客单单位为元（看板展示时换算为万元）。"],
  ["5", "门店类型只能填「同店」或「新店」；新店同期收入填 0。"],
  ["6", "门店客流表只填同店门店，门店名称必须与「门店」sheet 一致。"],
  ["7", "品类「本期同店销量」可留空，系统会按同店收入占比折算（演示口径）。"],
  ["8", "数值不能为负数，可以带千分位逗号；同期为 0 时增减率显示为空。"],
  ["9", "文件只在本机浏览器内解析和保存，不会上传到服务器。"],
];

/**
 * 标准结构 → 各 sheet 二维数组（第一行为表头）。
 * 用于生成下载模板和 CSV 样例；与 importWorkbook 互为逆操作。
 * @param {object} data 标准数据（data/revenue_2025-09.json 结构）
 * @returns {Record<string, Array<Array<string|number>>>}
 */
export function denormalize(data) {
  const period = data?.period ?? {};
  const sheets = {
    [INTRO_SHEET]: [
      ["项目", "内容"],
      [PERIOD_LABELS.base, String(period.base ?? "")],
      [PERIOD_LABELS.current, String(period.current ?? "")],
      ["", ""],
      ...INTRO_NOTES,
    ],
  };

  const rowsFor = {
    channels: (data?.channels ?? []).map((item) => ({
      channel: item.channel,
      base: item.base,
      current: item.current,
    })),
    stores: (data?.stores ?? []).map((item) => ({ ...item })),
    categories: (data?.categories ?? []).map((item) => ({
      category: item.category,
      base_qty: item.base?.qty,
      base_revenue: item.base?.revenue,
      current_qty: item.current?.qty,
      current_revenue: item.current?.revenue,
      same_store_current_qty: item.same_store_current_qty,
    })),
    store_traffic: (data?.store_traffic ?? []).map((item) => ({
      store: item.store,
      base_traffic: item.base?.traffic,
      base_ticket: item.base?.ticket,
      current_traffic: item.current?.traffic,
      current_ticket: item.current?.ticket,
    })),
  };

  for (const sheet of DATA_SHEETS) {
    const header = sheet.columns.map(headerText);
    const body = rowsFor[sheet.id].map((row) =>
      sheet.columns.map((column) => (row[column.key] === undefined || row[column.key] === null ? "" : row[column.key])),
    );
    sheets[sheet.name] = [header, ...body];
  }
  return sheets;
}
