/**
 * 一句话结论生成（每一层一句中文结论）。
 *
 * 只使用已算好的排序结果与阈值判断，不调用大模型，保证课堂现场结果稳定可复现。
 * 规则：点出该层最大的正向贡献项与最大的负向项（含金额），没有负向项时只点正向项。
 */

/** 门店客流客单表单位为元，结论里统一换算成万元展示。 */
const YUAN_PER_WAN = 10000;

function fmt(value, digits = 2) {
  return Number(value ?? 0).toFixed(digits);
}

function fmtSigned(value, digits = 2) {
  const num = Number(value ?? 0);
  return `${num >= 0 ? "+" : ""}${num.toFixed(digits)}`;
}

function fmtPct(rate, digits = 2) {
  if (rate === null || rate === undefined || !Number.isFinite(Number(rate))) return "—";
  return `${(Number(rate) * 100).toFixed(digits)}%`;
}

function fmtSignedPct(rate, digits = 2) {
  if (rate === null || rate === undefined || !Number.isFinite(Number(rate))) return "—";
  const num = Number(rate);
  return `${num >= 0 ? "+" : ""}${(num * 100).toFixed(digits)}%`;
}

/** 取最大项；空数组返回 null。 */
function pickMax(rows, getter) {
  let best = null;
  for (const row of rows) {
    if (best === null || getter(row) > getter(best)) best = row;
  }
  return best;
}

/** 取最小项；空数组返回 null。 */
function pickMin(rows, getter) {
  let worst = null;
  for (const row of rows) {
    if (worst === null || getter(row) < getter(worst)) worst = row;
  }
  return worst;
}

/** 去掉合计行。 */
function withoutTotal(rows, key) {
  return (rows ?? []).filter((row) => row && row[key] !== "合计" && row[key] !== "同店对比");
}

function findTotal(rows, key) {
  return (rows ?? []).find((row) => row && row[key] === "合计") ?? null;
}

function buildOverview(data, channel, storeMix) {
  const period = data?.period
    ? `${data.period.current} 对比 ${data.period.base}`
    : "本期对比同期";
  const ratioText =
    storeMix.same_store_ratio === null || storeMix.same_store_ratio === undefined
      ? ""
      : `，占本期收入 ${fmtPct(storeMix.same_store_ratio)}`;
  return (
    `${period}，渠道收入合计 ${fmt(channel.current_total)} 万元，` +
    `同比 ${fmtSigned(channel.diff)} 万元（${fmtSignedPct(channel.growth_rate)}）；` +
    `门店端同店收入 ${fmt(storeMix.same_store_current)} 万元，` +
    `同比 ${fmtSigned(storeMix.same_store_diff)} 万元（${fmtSignedPct(storeMix.same_store_growth)}）${ratioText}；` +
    `新店收入 ${fmt(storeMix.new_store_current)} 万元。`
  );
}

function buildChannelInsight(channel) {
  const rows = channel?.rows ?? [];
  if (rows.length === 0) return "暂无渠道数据。";

  const top = pickMax(rows, (row) => row.diff);
  const bottom = pickMin(rows, (row) => row.diff);
  if (top.diff === 0 && bottom.diff === 0) return "各渠道收入与同期持平。";
  if (bottom.diff < 0) {
    return (
      `渠道中 ${top.channel} 正向贡献最大（${fmtSigned(top.diff)} 万元，` +
      `同比${fmtSignedPct(top.growth_rate)}）；${bottom.channel} 负向最大（${fmtSigned(bottom.diff)} 万元）。`
    );
  }
  return `各渠道收入均未同比下滑，${top.channel} 贡献最大（${fmtSigned(top.diff)} 万元）。`;
}

function buildStoreMixInsight(storeMix) {
  let text =
    `同店收入 ${fmt(storeMix.same_store_current)} 万元，` +
    `同比 ${fmtSigned(storeMix.same_store_diff)} 万元（${fmtSignedPct(storeMix.same_store_growth)}）`;
  if (storeMix.same_store_ratio !== null && storeMix.same_store_ratio !== undefined) {
    text += `，占本期收入 ${fmtPct(storeMix.same_store_ratio)}`;
  }
  text += `；新店收入 ${fmt(storeMix.new_store_current)} 万元，占本期收入 ${fmtPct(
    1 - (storeMix.same_store_ratio ?? 0),
  )}。`;
  return text;
}

function buildStoreRankInsight(storeRank) {
  const revenueTop = storeRank?.by_revenue?.[0];
  const amountTop = storeRank?.by_growth_amount?.[0];
  const rateTop = storeRank?.by_growth_rate?.[0];
  if (!revenueTop || !amountTop || !rateTop) return "本期无同店门店数据。";
  return (
    `同店收入第一为 ${revenueTop.store}（${fmt(revenueTop.current)} 万元）；` +
    `增长额第一为 ${amountTop.store}（${fmtSigned(amountTop.diff)} 万元）；` +
    `增长率第一为 ${rateTop.store}（${fmtSignedPct(rateTop.growth_rate)}）。`
  );
}

function buildCategoryInsight(categoryQtyPrice) {
  const allRows = withoutTotal(categoryQtyPrice?.all ?? [], "category");
  if (allRows.length === 0) return "暂无品类数据。";

  const totalRow = findTotal(categoryQtyPrice.all, "category");
  const top = pickMax(allRows, (row) => row.total);
  const bottom = pickMin(allRows, (row) => row.total);

  let text;
  if (bottom.total < 0) {
    text =
      `全店口径品类中 ${top.category} 贡献最大（${fmtSigned(top.total)} 万元），` +
      `${bottom.category} 拖累最大（${fmtSigned(bottom.total)} 万元）`;
  } else {
    text = `全店口径品类全部同比增长，${top.category} 贡献最大（${fmtSigned(top.total)} 万元）`;
  }

  if (totalRow) {
    const driver = Math.abs(totalRow.qty_effect) >= Math.abs(totalRow.price_effect) ? "销量" : "单价";
    text +=
      `；合计销量影响 ${fmtSigned(totalRow.qty_effect)} 万元、` +
      `单价影响 ${fmtSigned(totalRow.price_effect)} 万元，${driver}是主要驱动`;
  }

  const sameStoreRows = withoutTotal(categoryQtyPrice?.same_store ?? [], "category");
  const sameStoreBottom = pickMin(sameStoreRows, (row) => row.total);
  if (sameStoreBottom && sameStoreBottom.total < 0) {
    text += `；同店口径下 ${sameStoreBottom.category} 拖累最大（${fmtSigned(sameStoreBottom.total)} 万元）`;
  }

  return `${text}。`;
}

function buildTrafficInsight(traffic) {
  const categoryRows = withoutTotal(traffic?.categories ?? [], "category");
  if (categoryRows.length === 0) return "暂无客流数据。";

  const categoryTotal = findTotal(traffic.categories, "category");
  let text = "";
  if (categoryTotal) {
    text =
      `客流影响 ${fmtSigned(categoryTotal.traffic_effect)} 万元、` +
      `人均销量影响 ${fmtSigned(categoryTotal.per_capita_qty_effect)} 万元、` +
      `单价影响 ${fmtSigned(categoryTotal.price_effect)} 万元`;
  }

  const storeRows = withoutTotal(traffic?.stores ?? [], "store");
  if (storeRows.length > 0) {
    const storeTop = pickMax(storeRows, (row) => row.traffic_effect);
    const storeBottom = pickMin(storeRows, (row) => row.traffic_effect);
    if (storeBottom.traffic_effect < 0) {
      text +=
        `；门店中 ${storeTop.store} 客流贡献最大（${fmtSigned(storeTop.traffic_effect / YUAN_PER_WAN)} 万元），` +
        `${storeBottom.store} 客流拖累最大（${fmtSigned(storeBottom.traffic_effect / YUAN_PER_WAN)} 万元）`;
    } else {
      text += `；门店客流均未下滑，${storeTop.store} 客流贡献最大（${fmtSigned(
        storeTop.traffic_effect / YUAN_PER_WAN,
      )} 万元）`;
    }
  }

  return `${text}。`;
}

/**
 * 生成每一层的一句话结论。
 * @param {{data: object, channel: object, store_mix: object, store_rank: object, category_qty_price: object, traffic: object}} sections
 * @returns {{overview: string, channel: string, store_mix: string, store_rank: string, category_qty_price: string, traffic: string}}
 */
export function buildInsights({
  data,
  channel,
  store_mix: storeMix,
  store_rank: storeRank,
  category_qty_price: categoryQtyPrice,
  traffic,
}) {
  return {
    overview: buildOverview(data, channel, storeMix),
    channel: buildChannelInsight(channel),
    store_mix: buildStoreMixInsight(storeMix),
    store_rank: buildStoreRankInsight(storeRank),
    category_qty_price: buildCategoryInsight(categoryQtyPrice),
    traffic: buildTrafficInsight(traffic),
  };
}
