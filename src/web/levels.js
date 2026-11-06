/**
 * 看板五层下钻与工具页的元数据（纯数据，路由与分析报告共用，保证名称一致）。
 */

/** 五层下钻，顺序即下钻顺序。 */
export const LEVELS = [
  {
    id: "channel",
    hash: "#/channel",
    level: 1,
    label: "渠道结构",
    title: "渠道收入结构",
    sub: "收入从哪些渠道来、各渠道同比增减与占比",
    insightKey: "channel",
  },
  {
    id: "store-mix",
    hash: "#/store-mix",
    level: 2,
    label: "同店 / 新店",
    title: "同店 / 新店结构与同店渠道拆解",
    sub: "增长来自老店还是新店，同店各渠道分别贡献多少",
    insightKey: "store_mix",
  },
  {
    id: "store-rank",
    hash: "#/store-rank",
    level: 3,
    label: "门店排名",
    title: "门店收入 / 增长额 / 增长率排名",
    sub: "同店门店三种排名，新店不参与增长排名",
    insightKey: "store_rank",
  },
  {
    id: "category",
    hash: "#/category",
    level: 4,
    label: "品类量价",
    title: "品类量价因素分析",
    sub: "收入变动拆成销量影响与单价影响，可切换全店 / 同店口径",
    insightKey: "category_qty_price",
  },
  {
    id: "traffic",
    hash: "#/traffic",
    level: 5,
    label: "客流客单",
    title: "客流 × 人均销量 × 单价三因素",
    sub: "同店品类三因素 + 门店客流客单两因素",
    insightKey: "traffic",
  },
];

/** 工具页：不属于五层下钻，不参与「继续下钻」链路。 */
export const TOOLS = [
  {
    id: "import",
    hash: "#/import",
    tool: true,
    label: "数据导入",
    title: "数据导入",
    sub: "下载模板 → 填写上传 → 校验预览 → 确认后替换看板数据（只在本机浏览器处理）",
  },
  {
    id: "report",
    hash: "#/report",
    tool: true,
    label: "分析报告",
    title: "收入分析报告",
    sub: "按月度经营分析汇报顺序整理五层结论，可打印 / 导出 PDF",
  },
];
