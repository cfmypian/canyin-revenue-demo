/**
 * 数据导入页（工具页 `#/import`）。
 *
 * 流程：下载模板 → 拖拽 / 选择上传 → 校验结果（错误阻断、警告可继续）→ 清洗后预览 → 确认导入 / 取消。
 * 文件只在本机浏览器内解析；确认前不会改动当前看板数据。
 */

import { DATA_SHEETS, SHEET_NAMES, formatIssue, headerText, importWorkbook } from "../../engine/index.js";
import { htmlEsc } from "../format.js";
import {
  TEMPLATE_FILE_NAME,
  UploadError,
  downloadCsvSample,
  downloadTemplate,
  readUploadFiles,
  xlsxReady,
} from "../importer/readFile.js";
import { panelHTML, tableHTML } from "../ui.js";

const PREVIEW_ROWS = 5;

/** 页面级状态：切换路由再回来时保留上一次校验结果（未确认的导入）。 */
let pending = null;

/** 标准数据 → 预览表格的行值（与模板列一一对应）。 */
const PREVIEW_VALUES = {
  channels: (item) => [item.channel, item.base, item.current],
  stores: (item) => [item.region, item.store, item.type, item.base, item.current],
  categories: (item) => [
    item.category,
    item.base.qty,
    item.base.revenue,
    item.current.qty,
    item.current.revenue,
    item.same_store_current_qty,
  ],
  store_traffic: (item) => [item.store, item.base.traffic, item.base.ticket, item.current.traffic, item.current.ticket],
};

/** 数值预览格式：最多 4 位小数，去掉多余的 0。 */
function previewCell(value) {
  if (typeof value === "number") return htmlEsc(String(Math.round(value * 10000) / 10000));
  return htmlEsc(value);
}

function issueList(issues, level) {
  if (issues.length === 0) return "";
  const title = level === "error" ? `错误 ${issues.length} 项（必须修改后重新上传）` : `警告 ${issues.length} 项（可继续导入）`;
  return `<div class="issue-group issue-group--${level}">
      <p class="issue-title">${title}</p>
      <ul class="issue-list" data-level="${level}">
        ${issues.map((issue) => `<li class="issue-item" data-code="${htmlEsc(issue.code)}">${htmlEsc(formatIssue(issue))}</li>`).join("")}
      </ul>
    </div>`;
}

function previewHTML(data, meta) {
  const derived = new Set((meta?.derived ?? []).flatMap((entry) => entry.items));
  return DATA_SHEETS.map((sheet) => {
    const items = data[sheet.id] ?? [];
    const columns = sheet.columns.map((column, index) => ({
      label: headerText(column),
      align: index === 0 || column.type !== "number" ? "left" : "right",
    }));
    const rows = items.slice(0, PREVIEW_ROWS).map((item) => {
      const values = PREVIEW_VALUES[sheet.id](item);
      return {
        cells: values.map((value, index) => {
          const isDerived = sheet.id === "categories" && index === values.length - 1 && derived.has(item.category);
          return { html: `${previewCell(value)}${isDerived ? '<span class="derived-tag">折算</span>' : ""}` };
        }),
      };
    });
    const more = items.length > PREVIEW_ROWS ? `（仅显示前 ${PREVIEW_ROWS} 行，共 ${items.length} 行）` : `（共 ${items.length} 行）`;
    return `<div class="preview-sheet">
        <p class="preview-title">${htmlEsc(sheet.name)} <span>${more}</span></p>
        ${tableHTML({ columns, rows, className: "tbl--compact" })}
      </div>`;
  }).join("");
}

export const importPage = {
  id: "import",

  render(root, ctx) {
    const xlsxOk = xlsxReady();

    root.innerHTML = `<div class="grid grid--import">
      ${panelHTML({
        title: "① 下载模板",
        subtitle: "5 个 sheet：说明、渠道、门店、品类、门店客流",
        body: `<div class="import-steps">
            <p>模板已预填演示样例数据，直接上传即可看到与演示看板一致的结果。请按「说明」sheet 填写，<strong>不要修改 sheet 名和表头</strong>。</p>
            <button type="button" class="btn btn--primary" id="btn-template" ${xlsxOk ? "" : "hidden"}>下载模板（${htmlEsc(TEMPLATE_FILE_NAME)}）</button>
            <div class="csv-fallback" id="csv-fallback" ${xlsxOk ? "hidden" : ""}>
              <p class="hint-warn">Excel 组件未加载，可改用 CSV 模板（每个 sheet 一个文件）：</p>
              <div class="btn-row">
                ${SHEET_NAMES.map((name) => `<button type="button" class="btn" data-csv="${htmlEsc(name)}">${htmlEsc(name)}.csv</button>`).join("")}
              </div>
            </div>
            <ul class="import-tips">
              <li>金额单位：渠道 / 门店 / 品类为万元；门店客流表客单为元。</li>
              <li>门店类型只能填「同店」或「新店」；门店客流表只填同店。</li>
              <li>品类「本期同店销量」可留空，系统按同店收入占比折算（演示口径）。</li>
            </ul>
          </div>`,
      })}
      ${panelHTML({
        title: "② 上传数据",
        subtitle: "支持 1 个 xlsx 文件，或按 sheet 拆分的多个 UTF-8 csv 文件",
        body: `<label class="dropzone" id="dropzone" tabindex="0">
            <input type="file" id="file-input" accept=".xlsx,.csv" multiple hidden />
            <span class="dropzone-title">拖拽文件到这里，或点击选择文件</span>
            <span class="dropzone-sub">文件只在本机浏览器内解析和保存，不会上传到服务器</span>
          </label>
          <div class="import-status" id="import-status" role="status" aria-live="polite"></div>`,
        note: `当前看板数据：${htmlEsc(ctx.dataset.source.type === "import" ? `导入 · ${ctx.dataset.source.fileName}` : "演示数据")}`,
      })}
      ${panelHTML({
        title: "③ 校验结果与预览",
        subtitle: "错误阻断导入；警告可确认后继续",
        className: "panel--result",
        body: '<div class="import-result" id="import-result"><p class="placeholder">上传文件后在这里显示校验结果与清洗后数据预览。</p></div>',
      })}
    </div>`;

    const status = root.querySelector("#import-status");
    const resultBox = root.querySelector("#import-result");
    const input = root.querySelector("#file-input");
    const dropzone = root.querySelector("#dropzone");

    const setStatus = (message, tone = "") => {
      status.className = `import-status${tone ? ` is-${tone}` : ""}`;
      status.textContent = message;
    };

    const showResult = () => {
      if (!pending) return;
      const { fileName, outcome } = pending;
      const { errors, warnings } = outcome.issues;
      const summary = `<div class="result-summary">
          <span class="result-file">${htmlEsc(fileName)}</span>
          <span class="count count--error" data-count="errors">错误 ${errors.length}</span>
          <span class="count count--warning" data-count="warnings">警告 ${warnings.length}</span>
        </div>`;
      const actions = `<div class="btn-row result-actions">
          <button type="button" class="btn btn--primary" id="btn-confirm" ${outcome.ok ? "" : "disabled"}>确认导入</button>
          <button type="button" class="btn" id="btn-cancel">取消</button>
          ${outcome.ok ? "" : '<span class="hint-warn">存在错误，修改文件后重新上传</span>'}
        </div>`;
      resultBox.innerHTML = `${summary}${actions}
        ${issueList(errors, "error")}
        ${issueList(warnings, "warning")}
        ${outcome.ok ? `<div class="preview">${previewHTML(outcome.data, outcome.meta)}</div>` : ""}`;
      resultBox.dataset.state = outcome.ok ? "valid" : "invalid";

      resultBox.querySelector("#btn-confirm")?.addEventListener("click", () => {
        if (!pending?.outcome.ok) return;
        const { outcome: ready, fileName: name } = pending;
        pending = null;
        ctx.actions.applyImport({ fileName: name, data: ready.data, meta: ready.meta });
      });
      resultBox.querySelector("#btn-cancel")?.addEventListener("click", () => {
        pending = null;
        resultBox.innerHTML = '<p class="placeholder">已取消，当前看板数据保持不变。</p>';
        resultBox.dataset.state = "cancelled";
        setStatus("");
        input.value = "";
      });
    };

    const handleFiles = async (files) => {
      setStatus("正在解析…");
      try {
        const { rawSheets, fileName } = await readUploadFiles(files);
        const outcome = importWorkbook(rawSheets);
        pending = { fileName, outcome };
        setStatus(outcome.ok ? "校验通过，请检查预览后确认导入" : "校验未通过", outcome.ok ? "ok" : "error");
        showResult();
      } catch (error) {
        pending = null;
        const message = error instanceof UploadError ? error.message : `文件读取失败：${error?.message ?? error}`;
        setStatus(message, "error");
        resultBox.innerHTML = '<p class="placeholder">当前看板数据保持不变。</p>';
        resultBox.dataset.state = "rejected";
        if (!(error instanceof UploadError)) console.error(error);
      } finally {
        input.value = "";
      }
    };

    input.addEventListener("change", () => handleFiles(input.files));
    dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input.click();
      }
    });
    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropzone.classList.add("is-over");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-over"));
    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-over");
      handleFiles(event.dataTransfer?.files);
    });

    root.querySelector("#btn-template")?.addEventListener("click", () => {
      if (!downloadTemplate(ctx.demoData)) {
        root.querySelector("#btn-template").hidden = true;
        root.querySelector("#csv-fallback").hidden = false;
      }
    });
    for (const button of root.querySelectorAll("[data-csv]")) {
      button.addEventListener("click", () => downloadCsvSample(ctx.demoData, button.dataset.csv));
    }

    showResult();
  },
};
