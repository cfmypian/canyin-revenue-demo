/**
 * 浏览器端文件读取：上传的 xlsx / csv → { sheet 名: 二维数组 }，以及模板下载。
 *
 * - xlsx 依赖 SheetJS（index.html 通过 CDN 固定版本引入，全局 window.XLSX）；
 * - csv 由引擎自带解析器处理，不依赖 SheetJS；多个 csv 按文件名结尾识别 sheet；
 * - 文件只在本机内存中解析，不发起任何网络请求。
 */

import { SHEET_NAMES, denormalize, parseCSV, sheetNameFromFileName, toCSV } from "../../engine/index.js";

export const TEMPLATE_FILE_NAME = "收入分析数据模板.xlsx";
export const UNSUPPORTED_MESSAGE = "仅支持 xlsx / csv 模板文件";

/** 可预期的上传错误（直接展示给用户）。 */
export class UploadError extends Error {}

/** SheetJS 是否已加载。 */
export function xlsxReady() {
  return typeof window !== "undefined" && Boolean(window.XLSX?.read && window.XLSX?.utils);
}

const extOf = (file) => (file.name.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();

/** 读取 xlsx：每个 sheet 转二维数组（保留空行，行号与 Excel 一致）。 */
async function readWorkbook(file) {
  if (!xlsxReady()) throw new UploadError("Excel 组件未加载，可改用 CSV 上传（每个 sheet 一个 csv 文件）");
  let workbook;
  try {
    workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  } catch {
    throw new UploadError(`${UNSUPPORTED_MESSAGE}：「${file.name}」无法解析`);
  }
  const rawSheets = {};
  for (const name of workbook.SheetNames) {
    rawSheets[name] = window.XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      raw: true,
      defval: "",
      blankrows: true,
    });
  }
  return rawSheets;
}

/**
 * 读取上传文件。
 * @param {FileList|File[]} fileList
 * @returns {Promise<{ rawSheets: Record<string, unknown[][]>, fileName: string }>}
 */
export async function readUploadFiles(fileList) {
  const files = Array.from(fileList ?? []);
  if (files.length === 0) throw new UploadError("请选择要上传的文件");
  if (files.some((file) => !["xlsx", "csv"].includes(extOf(file)))) {
    throw new UploadError(UNSUPPORTED_MESSAGE);
  }

  const workbooks = files.filter((file) => extOf(file) === "xlsx");
  if (workbooks.length > 0) {
    if (files.length > 1) throw new UploadError("一次只能上传 1 个 xlsx 文件，或多个 csv 文件");
    return { rawSheets: await readWorkbook(files[0]), fileName: files[0].name };
  }

  const rawSheets = {};
  for (const file of files) {
    const sheetName = sheetNameFromFileName(file.name);
    if (!sheetName) {
      throw new UploadError(`无法从文件名识别 sheet：「${file.name}」，文件名需以 ${SHEET_NAMES.join(" / ")} 结尾`);
    }
    rawSheets[sheetName] = parseCSV(await file.text());
  }
  return { rawSheets, fileName: files.length === 1 ? files[0].name : `${files.length} 个 CSV 文件` };
}

/** 各列宽度（字符数）：按表头和内容估算，便于打开模板时阅读。 */
function columnWidths(rows) {
  const widths = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      const text = String(cell ?? "");
      let width = 0;
      for (const ch of text) width += /[^\x00-\xff]/.test(ch) ? 2 : 1;
      widths[index] = Math.min(Math.max(widths[index] ?? 8, width + 2), 80);
    });
  }
  return widths.map((wch) => ({ wch }));
}

/** 触发浏览器下载。 */
function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 下载 xlsx 模板（预填演示样例）。SheetJS 未加载时返回 false，由页面给出 CSV 降级入口。
 * @param {object} demoData
 * @returns {boolean}
 */
export function downloadTemplate(demoData) {
  if (!xlsxReady()) return false;
  const { utils } = window.XLSX;
  const workbook = utils.book_new();
  for (const [name, rows] of Object.entries(denormalize(demoData))) {
    const sheet = utils.aoa_to_sheet(rows);
    sheet["!cols"] = columnWidths(rows);
    utils.book_append_sheet(workbook, sheet, name);
  }
  const buffer = window.XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  triggerDownload(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    TEMPLATE_FILE_NAME,
  );
  return true;
}

/** 单个 CSV 样例下载（SheetJS 不可用时的降级方式，内容与 data/templates/ 下文件一致）。 */
export function downloadCsvSample(demoData, sheetName) {
  const rows = denormalize(demoData)[sheetName];
  if (!rows) return;
  triggerDownload(new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8" }), `收入分析数据模板-${sheetName}.csv`);
}
