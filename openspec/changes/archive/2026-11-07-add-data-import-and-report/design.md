## Context

- 现状：`src/web/main.js` 启动时 fetch 固定的 `./data/revenue_2025-09.json`，交给 `analyze(data)`，结果 `{ data, result }` 作为 `ctx` 传给 hash 路由（`src/web/router.js` 的 `ROUTES`）和 `layout.js` 的页头、指标卡。
- 引擎已有约定：纯函数、不碰 DOM / fs；同店折算比例由门店表推导（`store_mix.same_store_ratio`，约 0.8570），不直接用 `same_store_share`。
- 约束：零构建、Node 测试零 npm 依赖、目录按 AGENTS.md 角色划分、无后端。
- 参考站点 ppv2.broadmind.cn 需登录，本次未能访问，只参考其"导入—看板—报告"的模块划分，不复刻页面。
- 需求与验收见 `specs/data-import/spec.md`、`specs/analysis-report/spec.md`。

## Goals / Non-Goals

**Goals:**
- 导入链路的解析、校验、标准化全部是纯函数，可在 Node 中用 golden 数据验证"模板原样上传 = 演示数据"。
- 现有五层页面不改计算、只换数据来源；报告页复用现有图表 option 构造函数。

**Non-Goals:**
- 不做 Web Worker、大文件（> 5 MB）优化；模板规模是十几家门店、几十行。
- 不做多数据集列表，同一时间只有一个"当前数据集"。

## Decisions

1. **导入管线拆成三步纯函数，放 `src/engine/import/`**（数据角色负责）
   - `parseSheets(rawSheets)`：输入 `{ sheetName: 二维数组 }`，按表头名映射列（不依赖列顺序），输出行对象 + 原始行号。
   - `validate(parsed)`：返回 `{ errors[], warnings[] }`，每项 `{ sheet, row, column, code, message }`；`code` 用固定枚举，测试按 code 断言，文案可调。
   - `normalize(parsed)`：输出标准结构，附 `meta: { derived: [...] }` 标明哪些字段为折算。
   - `importWorkbook(rawSheets)` 串联三步，返回 `{ ok, data, issues, meta }`。
   - 文件读取（File → 二维数组）属于浏览器 I/O，放前端 `src/web/importer/readFile.js`。这样引擎仍不碰 DOM，Node 测试直接喂二维数组或 CSV 文本。
   - 备选：在前端直接拼 JSON。否决，因为校验逻辑测不到，也违反"计算与展示分离"。

2. **Excel 读写用 SheetJS CDN 固定版本**（`xlsx@0.20.x` 的 `xlsx.full.min.js`，从 cdn.sheetjs.com 引入）
   - 浏览器端读 `.xlsx`、生成模板下载都靠它；CSV 由引擎自带的小解析器处理（支持引号、逗号、BOM），因此 Node 测试不需要 SheetJS。
   - 备选：只支持 CSV。否决，老板和客户都用 Excel，一个文件 5 个 sheet 比 5 个 CSV 好用。
   - 备选：npm 引入。否决，破坏零依赖。

3. **模板由代码生成，样例数据来自演示 JSON**
   - `src/engine/import/template.js` 导出模板定义（sheet 名、列名、单位、必填、类型）和 `denormalize(data)`（标准结构 → 各 sheet 二维数组）。前端用 SheetJS 把二维数组写成 xlsx 下载。
   - 同一份列定义既驱动模板生成也驱动解析校验，避免两处漂移；`denormalize → importWorkbook` 往返测试保证等价。
   - 另在 `data/templates/` 放一份 CSV 样例，供 Node 测试和不想用 Excel 的人。
   - 期间填在「说明」sheet 的固定单元格（同期月份、本期月份，`YYYY-MM`）。

4. **同店销量折算口径与引擎一致**：缺"本期同店销量"时用门店表推导的同店收入占比（同店门店本期收入 / 全部门店本期收入），不用 `same_store_share`。`same_store_share` 同样由门店表计算后写入，保持字段完整。

5. **当前数据集用 localStorage 持久化，单键存储**
   - 键 `canyin.dataset.v1`，值 `{ version: 1, source: { type: "import"|"demo", fileName, importedAt }, data }`。读取时重新跑 `validate`，失败即清除并回退演示数据。
   - `src/web/dataset.js` 封装 `loadCurrentDataset() / saveImported() / resetToDemo()`；`main.js` 改为调用它。导入成功后重新 `analyze` 并重建 `ctx`，路由跳 `#/channel`，不整页刷新。
   - 备选：IndexedDB。否决，数据量几 KB，localStorage 足够且代码少。

6. **路由新增 `#/import`、`#/report`，不算入五层下钻**：导航中放在五层之后、视觉上与"第 N 层"区分，"继续下钻"链路不变。

7. **报告页 = 同一 `ctx` 的长页面 + 打印样式**
   - `src/web/pages/report.js` 按章节调用现有 `charts.js` 的 option 函数和各层 insights，不重新计算。
   - 打印：`@media print` 隐藏导航 / 按钮，`break-before: page`、`break-inside: avoid`；打印前把 ECharts 切到固定宽度并 `resize`，监听 `beforeprint` / `afterprint`。
   - 备选：jsPDF / html2canvas 生成 PDF。否决，多两个依赖，中文字体处理麻烦，浏览器"另存为 PDF"效果更好。

## Risks / Trade-offs

- [SheetJS CDN 不可达] → 导入页提示"Excel 组件未加载，可改用 CSV 上传"，CSV 路径不依赖 SheetJS；模板下载降级为下载 `data/templates/` 下的 CSV 样例。
- [客户填的表头有空格、全角括号、单位写法不同] → 表头匹配前做归一化（去空格、全角转半角、去掉"（万元）"等单位后缀），并在模板「说明」sheet 写明不要改表头。
- [Excel 单元格是公式或带格式的数字] → SheetJS 读取时取计算值（`raw` 值）；字符串数字统一走清洗。
- [localStorage 中保存了用户真实数据] → 只在本机，页面明确提示；"恢复演示数据"会清除。不做跨设备同步。
- [渠道合计与门店合计不一致] → 按 1% 阈值给警告不阻断，因为真实业务中两套口径常有差异；看板各层仍按各自表计算。
- [打印分页在不同浏览器表现不同] → 以 Chrome 为验收基准，在 smoke 中只校验报告页可渲染、无错误。

## Migration Plan

- 首次打开无 localStorage 时行为与现在一致（加载演示数据），已有链接 `#/channel` 等不变。
- 回滚：移除导航入口与 `dataset.js`，`main.js` 恢复直接 fetch 演示 JSON 即可；用户本机残留的 `canyin.dataset.v1` 不影响旧版。

## Open Questions

- 报告封面是否需要客户品牌名 / Logo 输入框：可在后续迭代加一个可选字段，不影响本次结构。
