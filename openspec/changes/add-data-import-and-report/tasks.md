# Tasks

> 前置：`add-revenue-analysis-dashboard` 已完成并归档。每项完成后运行 `npm test`，全部通过才能勾选。

## 1. 模板定义与样例

- [x] 1.1 [数据] 在 `src/engine/import/template.js` 定义 5 个 sheet 的列定义（列名、单位、必填、类型、主键），验证：`tests/import-template.test.js` 断言 sheet 与列齐全
- [x] 1.2 [数据] 实现 `denormalize(data)`（标准结构 → 各 sheet 二维数组），并在 `data/templates/` 生成演示 CSV 样例，验证：样例文件存在且行数与演示 JSON 一致
- [x] 1.3 [测试] 编写模板往返测试：`denormalize(演示数据) → importWorkbook → analyze` 与 `data/golden_expected.json` 每项偏差 <= 0.01，验证：`node --test tests/import-roundtrip.test.js` 通过

## 2. 数据处理引擎

- [x] 2.1 [数据] 实现 CSV 文本解析（引号、逗号、BOM、空行）与 `parseSheets`（表头归一化、按列名映射、保留原始行号），验证：`tests/import-parse.test.js` 覆盖全角括号、带单位后缀表头
- [x] 2.2 [数据] 实现 `validate`：缺 sheet、缺必填列、非数字、负数、主键重复、跨表引用不存在，返回带 `sheet/row/column/code` 的错误清单，验证：`tests/import-validate.test.js` 逐个 code 断言
- [x] 2.3 [数据] 在 `validate` 中加入警告规则：渠道合计与门店合计差异 > 1%、同期为 0，验证：同一测试文件中警告用例通过且不阻断
- [x] 2.4 [数据] 实现 `normalize`：去空格与千分位、类型统一、期间读取、按门店推导同店占比写入 `same_store_share`、缺失时折算 `same_store_current_qty` 并记入 `meta.derived`，验证：`tests/import-normalize.test.js` 通过
- [x] 2.5 [测试] 编写折算 golden 对比测试：演示样例删除"本期同店销量"列后导入，同店品类量价与客流三因素结果与 golden 偏差 <= 0.01，验证：`node --test tests/import-derive.test.js` 通过
- [x] 2.6 [数据] 实现 `importWorkbook` 串联三步并从 `src/engine/index.js` 导出，验证：引擎目录 `grep` 无 DOM / fs 引用，全部 import 测试通过

## 3. 数据导入页

- [x] 3.1 [前端] `index.html` 引入 SheetJS 固定版本 CDN，实现 `src/web/importer/readFile.js`（xlsx / csv → `{ sheetName: 二维数组 }`），不支持的格式给提示，验证：在浏览器上传演示 xlsx 控制台输出 5 个 sheet
- [x] 3.2 [前端] 实现"下载模板"：用 `denormalize(演示数据)` 生成 `收入分析数据模板.xlsx`（含「说明」sheet）；SheetJS 未加载时降级下载 CSV 样例，验证：下载文件重新上传零错误
- [x] 3.3 [前端] 实现 `src/web/pages/import.js`：拖拽 / 选择上传、错误与警告清单（sheet · 行 · 列 · 原因）、有错误时禁用导入，验证：上传构造的错误文件看到对应清单
- [x] 3.4 [前端] 实现清洗后预览（每表前 5 行）与"确认导入 / 取消"，验证：取消后看板数据不变

## 4. 当前数据集与看板接入

- [x] 4.1 [前端] 实现 `src/web/dataset.js`（localStorage 键 `canyin.dataset.v1`，读取时重新校验，损坏回退演示数据并提示），验证：手动写入非法值后刷新，看板显示演示数据和提示
- [x] 4.2 [前端] 改造 `main.js` 与路由：启动读当前数据集；导入成功后重建 `ctx` 跳 `#/channel`；新增 `#/import`、`#/report` 路由与导航入口，验证：导入修改过数值的文件后指标卡与结论随之变化
- [x] 4.3 [前端] 页头显示数据来源 / 文件名 / 期间 / 导入时间，提供"恢复演示数据"；折算口径时显示注释，验证：刷新后仍显示导入文件名，恢复后显示"演示数据"

## 5. 分析报告

- [x] 5.1 [前端] 实现 `src/web/pages/report.js`：封面、总览指标、五层章节（结论 + 主图 + 关键表）、结论汇总，复用 `charts.js` 和 insights，验证：报告结论文字与看板各层一致
- [x] 5.2 [前端] 报告口径与单位注释（万元、门店客流元→万元、同店折算），验证：导入折算数据时品类与客流章节出现注释
- [x] 5.3 [前端] 打印样式：A4 纵向、隐藏导航按钮、章节分页、图表打印前固定宽度 resize；ECharts 未加载时显示降级提示，验证：Chrome"另存为 PDF"检查版式
- [x] 5.4 [测试] 编写报告数据一致性测试：报告所用指标与 `analyze()` 结果、golden 首页指标偏差 <= 0.01，验证：`node --test tests/report.test.js` 通过

## 6. 集成验收

- [x] 6.1 [测试] 扩展 `scripts/smoke.mjs`：覆盖 `#/import`、`#/report` 可渲染无错误条；注入 localStorage 导入数据后看板读取正确；`SMOKE_BLOCK_ECHARTS=1` 下报告降级正常，验证：`npm run smoke` 通过
- [x] 6.2 [测试] 端到端走查：下载模板 → 改 3 个数 → 上传 → 看板 → 报告导出 PDF，记录结果，验证：数值与手算一致、无报错

## Workflow follow-up

- [产品] 汇总验收结果，开 PR，在飞书汇报一句话结果。
- [产品] 确认 `npm test` 通过后归档本次变更。
