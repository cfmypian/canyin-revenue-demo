/**
 * 极简 CSV 读写（RFC 4180 子集），浏览器与 Node 共用。
 *
 * 支持：逗号分隔、双引号包裹、引号内逗号 / 换行、"" 转义、UTF-8 BOM、CRLF / LF。
 * 不做类型转换，所有单元格都是字符串（数值清洗交给 validate / normalize）。
 */

/**
 * CSV 文本 → 二维数组。保留空行（行号与表格软件一致）。
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCSV(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  // 末行没有换行符
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** 单元格需要引号时加引号。 */
function quote(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * 二维数组 → CSV 文本（CRLF 换行，可选 BOM 方便 Excel 识别 UTF-8）。
 * @param {Array<Array<unknown>>} rows
 * @param {{ bom?: boolean }} [options]
 * @returns {string}
 */
export function toCSV(rows, { bom = true } = {}) {
  const body = rows.map((row) => row.map(quote).join(",")).join("\r\n");
  return `${bom ? "\uFEFF" : ""}${body}\r\n`;
}
