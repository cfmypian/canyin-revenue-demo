/**
 * 当前数据集管理：演示数据 / 用户导入数据二选一。
 *
 * - 导入数据只存本机浏览器 localStorage（键 canyin.dataset.v1），不上传任何服务器；
 * - 读取时用引擎同一套规则重新校验，结构损坏或校验失败即清除并回退演示数据；
 * - 返回的数据集结构：{ data, source: { type, fileName, importedAt }, meta, notice }。
 */

import { formatIssue, revalidateDataset } from "../engine/index.js";

export const STORAGE_KEY = "canyin.dataset.v1";
const VERSION = 1;

/** 演示数据集。 */
function demoDataset(demoData, notice = null) {
  return {
    data: demoData,
    source: { type: "demo", fileName: "data/revenue_2025-09.json", importedAt: null },
    meta: { derived: [] },
    notice,
  };
}

function storage() {
  try {
    return window.localStorage;
  } catch {
    // 隐私模式 / 禁用存储时不可用
    return null;
  }
}

function clearStored() {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
}

/**
 * 读取当前数据集（启动时调用）。
 * @param {object} demoData 演示数据
 */
export function loadCurrentDataset(demoData) {
  const store = storage();
  let raw = null;
  try {
    raw = store?.getItem(STORAGE_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (!raw) return demoDataset(demoData);

  try {
    const entry = JSON.parse(raw);
    if (!entry || entry.version !== VERSION || entry.source?.type !== "import") {
      throw new Error("版本或来源不匹配");
    }
    const checked = revalidateDataset(entry.data);
    if (!checked.ok) {
      throw new Error(checked.issues.errors.slice(0, 3).map(formatIssue).join("；"));
    }
    return {
      data: checked.data,
      source: entry.source,
      // 折算标记以导入时为准（重新校验时同店销量已是数值，无法再判断是否折算）
      meta: entry.meta ?? checked.meta,
      notice: null,
    };
  } catch (error) {
    console.warn("本机导入数据无效，已回退演示数据：", error);
    clearStored();
    return demoDataset(demoData, "本机导入数据已失效，已恢复演示数据");
  }
}

/**
 * 保存导入数据并返回新的当前数据集。保存失败（存储不可用 / 超额）时仍返回数据集，
 * 并附带提示：本次会话可用，刷新后回到演示数据。
 * @param {{ fileName: string, data: object, meta: object }} payload
 */
export function saveImported({ fileName, data, meta }) {
  const source = { type: "import", fileName, importedAt: new Date().toISOString() };
  const entry = { version: VERSION, source, data, meta };
  let notice = null;
  try {
    const store = storage();
    if (!store) throw new Error("浏览器存储不可用");
    store.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch (error) {
    notice = `导入数据未能保存到本机（${error?.message ?? error}），刷新页面后将回到演示数据`;
  }
  return { data, source, meta, notice };
}

/** 清除导入数据，回到演示数据。 */
export function resetToDemo(demoData) {
  clearStored();
  return demoDataset(demoData);
}

/** 数据来源的显示文本。 */
export function sourceLabel(source) {
  if (!source || source.type !== "import") return "演示数据";
  return `导入：${source.fileName}`;
}

/** 导入时间的显示文本（YYYY-MM-DD HH:mm）。 */
export function importedAtLabel(source) {
  if (!source?.importedAt) return "";
  const date = new Date(source.importedAt);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
