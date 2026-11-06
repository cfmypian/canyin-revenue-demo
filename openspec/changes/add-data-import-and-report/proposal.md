## Why

现在看板只能读仓库里写死的 `data/revenue_2025-09.json`，换一家客户、换一个月份都得让开发改文件，课堂上没法现场演示"客户自己填表 → 系统出分析"。本变更补齐"下载模板 → 填数上传 → 校验清洗 → 看板 → 分析报告"这条链路，让 demo 从"看一份样例"变成"能用自己的数据跑一遍"，产品形态参考 ProfitPilot（ppv2.broadmind.cn）的"导入—看板—报告"三段式。

## What Changes

- 新增**数据上传模板**：一个 Excel 模板（5 个 sheet：说明、渠道、门店、品类、门店客流），列结构与课程 Excel「第二步-餐饮收入结构分析」「第二步-收入异动分析」的输入区一一对应（收入结构表1 渠道、表2 区域/门店；收入异动表3 品类、表6 门店客流客单），附样例数据，可在页面下载。
- 新增**数据处理引擎**（纯函数，浏览器内运行）：
  - 解析上传的 `.xlsx` / `.csv` 文件，转换为与 `data/revenue_2025-09.json` 相同的标准结构；
  - 逐表校验（必填列、数值类型、负数、重复门店/渠道、跨表一致性如门店客流表的门店必须出现在门店表），输出带行号的错误与警告清单；
  - 补齐派生字段：缺失 `same_store_current_qty` 时按同店收入占比折算，并标注为演示口径。
  - 清洗后的数据直接交给现有 `analyze(data)`，五层计算公式不变。
- 新增**数据导入页**（看板新入口）：下载模板、拖拽上传、展示校验结果（错误阻断、警告可继续）、预览清洗后数据、确认后进入看板；可一键"恢复演示数据"。
- **看板数据源可切换**：看板改为读取"当前数据集"（导入数据或演示数据），页头显示数据来源、期间和导入时间；导入数据只保存在本机浏览器（localStorage），不上传任何服务器。
- 新增**分析报告**：按 PPT 第 15-29 页的汇报顺序，把五层结论、关键指标和图表拼成一份可打印的单页报告（浏览器"打印 / 另存为 PDF"），结论仍由 `insights.js` 规则生成。

## Capabilities

### New Capabilities

- `data-import`: 数据上传模板、文件解析、校验与清洗，产出可供 `analyze()` 使用的标准数据集，以及看板当前数据集的来源管理
- `analysis-report`: 基于分析结果生成按汇报顺序排列、可打印导出的收入分析报告

### Modified Capabilities

（无。`revenue-engine` / `revenue-dashboard` 仍在进行中的变更 `add-revenue-analysis-dashboard` 内、尚未归档到 `openspec/specs/`；本变更对看板的改动——数据源切换、导入入口、报告入口——以新需求写在 `data-import` / `analysis-report` 中，不修改五层计算规则。）

## Impact

- 依赖前置：`add-revenue-analysis-dashboard` 先完成并归档（本变更复用其 `analyze()` 和页面框架）。
- 新增代码：`src/engine/import/`（解析、校验、标准化，纯函数）、`data/templates/`（模板与样例）、`src/web/pages/import.js`、`src/web/pages/report.js`、`tests/import*.test.js`、`tests/report*.test.js`。
- 修改：`src/web/main.js`（数据源加载）、`src/web/router.js`（新增 `#/import`、`#/report`）、`index.html`（导航入口、引入 SheetJS）、`scripts/smoke.mjs`（冒烟覆盖新页面）。
- 新增外部依赖：SheetJS（`xlsx`，CDN 固定版本）用于浏览器内读写 Excel；Node 测试只测 CSV / 已解析的二维数组路径，保持零 npm 依赖。
- 隐私：文件只在浏览器内解析和存储，无后端、无网络上传。

## Out of scope

- 后端服务、数据库、账号登录、多租户与权限（参考站点的登录体系本期不做）
- 毛利、费用、利润桥分析（后续模块）
- 多期数据管理、历史版本对比、跨月趋势
- 大模型生成报告文字；Word / PPT 格式导出（仅支持浏览器打印为 PDF）
- 直接对接收银 / 外卖平台 API 拉数
- 真实客户数据入库（仓库内只放模拟样例）
