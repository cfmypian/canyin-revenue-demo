/**
 * 页面 HTML 片段工具：面板、明细表、排名徽章。
 *
 * 只负责拼 HTML 字符串，不碰数据计算，页面模块通过组合这些片段保持结构一致。
 */

import { htmlEsc } from "./format.js";

/**
 * 面板：标题 + 可选副标题 / 右侧操作 + 内容体 + 可选脚注。
 * @param {{ title: string, subtitle?: string, actions?: string, body?: string, note?: string, className?: string }} options
 * @returns {string}
 */
export function panelHTML({ title, subtitle = "", actions = "", body = "", note = "", className = "" }) {
  return `<section class="panel ${className}">
      <header class="panel-head">
        <div class="panel-title-wrap">
          <h2 class="panel-title">${htmlEsc(title)}</h2>
          ${subtitle ? `<p class="panel-sub">${htmlEsc(subtitle)}</p>` : ""}
        </div>
        ${actions}
      </header>
      <div class="panel-body">${body}</div>
      ${note ? `<p class="panel-note">${note}</p>` : ""}
    </section>`;
}

/**
 * 明细表。
 *
 * columns: [{ label, align?: "left" | "right", width?: "26%" }]
 * rows: [{ cells: Array<string | { html: string, tone?: "pos" | "neg" | "flat" }>, className?: string }]
 * @param {{ columns: Array<object>, rows: Array<object>, className?: string }} options
 * @returns {string}
 */
export function tableHTML({ columns, rows, className = "" }) {
  const colgroup = columns
    .map((column) => `<col${column.width ? ` style="width: ${column.width}"` : ""} />`)
    .join("");
  const head = columns
    .map((column) => `<th class="${column.align === "left" ? "left" : "num"}">${htmlEsc(column.label)}</th>`)
    .join("");
  const body = rows
    .map((row) => {
      const cells = row.cells
        .map((cell, index) => {
          const value = typeof cell === "string" ? { html: cell } : cell ?? { html: "" };
          const align = columns[index]?.align === "left" ? "left" : "num";
          const tone = value.tone ? ` ${value.tone}` : "";
          return `<td class="${align}${tone}">${value.html}</td>`;
        })
        .join("");
      return `<tr class="${row.className ?? ""}">${cells}</tr>`;
    })
    .join("");
  return `<table class="tbl ${className}"><colgroup>${colgroup}</colgroup><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** 排名徽章：前三名高亮。 */
export function rankBadge(rank) {
  const top = Number(rank) <= 3 ? ` top${Number(rank)}` : "";
  return `<span class="rank-badge${top}">${htmlEsc(rank)}</span>`;
}
