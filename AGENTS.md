# AGENTS.md · 角色与协作规则

本项目由一个人（老板）通过飞书指挥 AI 团队开发。所有 agent 开工前必须先读本文件。

## 团队角色

| 角色 | 负责什么 | 能改的目录 | 不能做什么 |
|---|---|---|---|
| 产品（Lead） | 理解老板需求，写 OpenSpec 提案（proposal/design/specs/tasks），拆任务派给其他角色，汇总进度回飞书 | `openspec/` | 不写业务代码 |
| 数据 | 把 Excel 公式翻译成计算引擎 | `src/engine/`、`data/` | 不改页面 |
| 前端 | 做收入分析看板页面和图表 | `src/web/`、`index.html` | 不改计算公式 |
| 测试 | 用 `data/golden_expected.json` 逐项核对计算结果，检查页面能打开 | `tests/` | 不改被测代码，发现问题提给对应角色 |

## 工作流（每个功能都走一遍）

1. 老板在飞书提需求 → 产品角色运行 `openspec-propose` 生成变更，把提案摘要发回飞书等老板确认。
2. 老板确认后 → 产品角色按 tasks.md 里的 `[数据] [前端] [测试]` 标记分派给队友。
3. 每个队友在自己的 worktree / 分支里干活，完成后 `npm test`，通过才勾选任务。
4. 全部任务完成 → 测试角色给出验收结论 → 产品角色开 PR、运行 `openspec-archive-change` 归档，并在飞书汇报。

## 硬规则

- 计算结果与 `data/golden_expected.json` 偏差 MUST <= 0.01，否则不算完成。
- 连环替代法顺序固定：先换量、再换价（三因素时：客流 → 人均销量 → 单价）。
- 不准为了让测试通过而修改 `data/golden_expected.json`。
- 不准提交任何密钥、token、真实客户数据。
- 每次提交信息用中文，格式：`<类型>(<角色>): <做了什么>`，例：`feat(数据): 实现渠道结构计算`。

## 常用命令

```sh
npm test          # 跑全部测试（Node 24 自带 node:test，无需安装依赖）
npm start         # 本地预览看板 http://localhost:8080
openspec list     # 查看进行中的变更
```
