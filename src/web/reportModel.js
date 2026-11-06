/**
 * 分析报告数据模型（纯函数，不碰 DOM，Node 测试可直接调用）。
 *
 * 报告所有数字和结论都取自同一次 analyze() 结果（ctx.result），不重新计算：
 * - 总览指标与看板指标卡共用 buildMetrics；
 * - 每章结论直接取 result.insights[层级 insightKey]，与看板顶部结论一致；
 * - 章节顺序与名称取自 levels.js，与看板五层导航一致。
 */

import { LEVELS } from "./levels.js";
import { buildMetrics } from "./metrics.js";

/** 每章的口径 / 单位注释（同店折算注释仅在数据为折算时出现）。 */
function chapterNotes(levelId, derived) {
  const derivedNote = "同店口径为按同店收入占比折算（演示口径），品类本期同店销量由系统折算。";
  switch (levelId) {
    case "channel":
      return ["金额单位：万元；占比为占本期渠道合计。"];
    case "store-mix":
      return ["金额单位：万元；同店渠道收入 = 渠道本期收入 × 同店收入占比（演示口径）。"];
    case "store-rank":
      return ["金额单位：万元；新店不参与增长额 / 增长率排名。"];
    case "category":
      return ["金额单位：万元；销量单位：份。销量影响 = 销量差 × 同期单价，单价影响 = 单价差 × 本期销量。", ...(derived ? [derivedNote] : [])];
    case "traffic":
      return [
        "品类三因素金额单位：万元；门店客流客单表原始单位为元，报告中换算为万元。",
        ...(derived ? [derivedNote] : []),
      ];
    default:
      return [];
  }
}

/**
 * @param {{ data: object, result: object, dataset: { source: object, meta: object } }} ctx
 * @param {Date} [now]
 */
export function buildReportModel(ctx, now = new Date()) {
  const { data, result, dataset } = ctx;
  const source = dataset?.source ?? { type: "demo" };
  const derived = (dataset?.meta?.derived ?? []).some((entry) => entry.field === "same_store_current_qty");

  const chapters = LEVELS.map((level) => ({
    id: level.id,
    level: level.level,
    title: level.label,
    fullTitle: level.title,
    insight: result.insights?.[level.insightKey] ?? "",
    notes: chapterNotes(level.id, derived),
  }));

  return {
    cover: {
      title: "餐饮收入分析报告",
      sourceType: source.type === "import" ? "import" : "demo",
      sourceText: source.type === "import" ? `导入数据：${source.fileName}` : "演示数据（非真实经营数据）",
      period: { base: data?.period?.base ?? "", current: data?.period?.current ?? "" },
      generatedAt: now,
    },
    overview: { metrics: buildMetrics({ data, result }), insight: result.insights?.overview ?? "" },
    chapters,
    summary: chapters.map((chapter) => ({ title: chapter.title, insight: chapter.insight })),
    derived,
  };
}
