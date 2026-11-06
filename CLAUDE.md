# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

中文回答；

## 项目概况

餐饮经营分析系统 · 收入分析模块 demo：把课程 Excel《利润桥及毛利率分析》「第二步-餐饮收入结构分析」「第二步-收入异动分析」两个 sheet 的公式翻译成程序，做成纯静态看板（五层下钻，每层一句话结论）。

开发由多个 AI 角色（产品 / 数据 / 前端 / 测试）协作完成，**开工前必须先读 [AGENTS.md](AGENTS.md)**：角色能改的目录、工作流、提交信息格式（`<类型>(<角色>): <做了什么>`，中文）都在那里。

当前状态：只有数据、OpenSpec 提案和规则文件；`src/engine/`、`src/web/`、`index.html`、`tests/` 尚未创建，任务清单见 `openspec/changes/add-revenue-analysis-dashboard/tasks.md`。

## 常用命令

```sh
npm test                              # node --test tests/（Node >= 24.9，零依赖）
node --test tests/<file>.test.js      # 跑单个测试文件
node --test --test-name-pattern="渠道" tests/   # 按测试名过滤
npm start                             # http-server 预览 http://localhost:8080（无缓存）
openspec list                         # 查看进行中的变更
```

没有构建步骤、没有 lint、没有 npm 依赖。

## 架构（按 design.md 约定）

- **计算与展示分离**：`src/engine/` 是纯函数 ES Module，浏览器和 Node 测试共用同一份代码，因此引擎里不能用 Node 专属 API（fs 等），也不能碰 DOM。
- **引擎一层一个文件**：`channel` / `storeMix` / `storeRank` / `categoryFactor` / `trafficFactor`，结论规则放 `insights.js`（只用排序和阈值，不调大模型），`index.js` 统一导出 `analyze(data)`。
- **页面**：原生 HTML + ES Module + ECharts（CDN），不用 React/Vue。`index.html` 只由前端角色改。
- **数据**：
  - `data/revenue_2025-09.json`：输入。顶层键 `period, same_store_share, channels, stores, categories, store_traffic`；base=2024-09（同期），current=2025-09（本期）。
  - `data/golden_expected.json`：验收基准，**只读，不准为过测试而修改**。顶层键 `channel, store_mix, samestore_channel_current, category_qty_price, samestore_category_qty_price, traffic_percapita_price, store_traffic_ticket_yuan`，测试应逐项与 `analyze()` 输出比对。

## 计算规则（容易出错的点）

- 与 golden 偏差 MUST <= 0.01。
- 连环替代法顺序固定：先换量、再换价；三因素为 客流 → 人均销量 → 单价。每步 = 替换后 − 替换前，各因素影响之和必须等于收入差。
- 同期为 0 时增减率为空（不是 0 或 Infinity）。
- 单位：渠道、门店、品类金额为万元，品类销量为份；门店客流客单表（`store_traffic` / `store_traffic_ticket_yuan`）单位为元，展示时换算成万元。
- 同店口径的渠道和品类数据是按 `same_store_share`（0.857）折算的演示口径，页面需注明。

## OpenSpec

需求变更走 `openspec/`（`openspec/config.yaml` 有写作规则）：产物用 zh-CN，保留英文结构标题和 SHALL/MUST；proposal 要写清对应 Excel 表与 PPT 页并列 Out of scope；tasks 每项标注 `[产品] [数据] [前端] [测试]`、单项不超过 2 小时，涉及计算的任务必须配 golden 对比测试任务。归档前 `npm test` 必须通过。
