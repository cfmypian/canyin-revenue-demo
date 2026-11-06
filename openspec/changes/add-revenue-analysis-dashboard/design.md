## Context

老板不写代码，现有分析全部在 Excel 里。demo 要能在课堂现场打开，并且要能展示"一个人指挥多个 AI 角色开发"的过程。所以技术方案优先考虑三点：零安装、结果可核对、每个角色的改动范围清楚。

## Goals / Non-Goals

**Goals:**
- 计算与展示分离：计算引擎是纯函数，测试 agent 能在命令行里直接比对 Excel 基准。
- 打开 `index.html` 就能用，也能直接发布到 GitHub Pages。
- 目录边界和 AGENTS.md 里的角色分工一一对应，减少多个 agent 并行时的冲突。

**Non-Goals:**
- 不做后端、数据库、登录。
- 不做 Excel 上传（下一个变更）。

## Decisions

1. **纯静态页面 + 原生 ES Module**：不用 React/Vue，没有构建步骤，避免 agent 花时间配环境，演示时也不会因为依赖装不上而翻车。备选方案 React + Vite 更适合商用阶段，等第二个模块再评估。
2. **ECharts（CDN 引入）画图**：国内用户熟悉，瀑布图、占比图都有现成写法。
3. **计算引擎放 `src/engine/`，一个分析层一个文件**：channel / storeMix / storeRank / categoryFactor / trafficFactor，外加 `index.js` 统一导出 `analyze(data)`。浏览器和 Node 测试共用同一份代码。
4. **结论生成放 `src/engine/insights.js`，规则化**：只用排序和阈值，不调大模型，保证课堂现场结果稳定可复现。
5. **验收基准用 Excel 公式重算**：原 Excel 文件未保存公式计算结果，`data/golden_expected.json` 由公式引擎按原公式重算生成，数字已与 PPT 页面核对一致。
6. **单位约定**：渠道、门店、品类金额单位为万元；门店客流客单分析单位为元，展示时换算成万元。

## Risks / Trade-offs

- [模拟数据里同店口径的渠道和品类是按收入占比折算的] → 在页面和文档中注明这是课程演示口径，真实系统需要按门店明细计算。
- [多个 agent 同时改 `index.html`] → 页面入口只由前端角色修改，其他角色只改自己的目录。
- [DSH 团队插件是实验版] → 课前完整彩排一次，并录制备用视频。
