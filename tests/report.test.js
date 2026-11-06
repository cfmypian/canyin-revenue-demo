// 5.4 报告数据一致性：报告所用指标 / 结论与 analyze() 结果、golden 一致
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyze, importWorkbook } from '../src/engine/index.js';
import { LEVELS } from '../src/web/levels.js';
import { buildReportModel } from '../src/web/reportModel.js';
import { assertClose, colIndex, demo, demoSheets, golden } from './_import_helpers.js';

const demoCtx = () => {
  const data = demo();
  return { data, result: analyze(data), dataset: { source: { type: 'demo' }, meta: { derived: [] } } };
};

test('5.4 报告结构：封面 → 总览 → 五层章节 → 结论汇总，章节名与看板五层一致', () => {
  const model = buildReportModel(demoCtx());
  assert.equal(model.cover.title, '餐饮收入分析报告');
  assert.deepEqual(model.chapters.map((c) => c.title), LEVELS.map((l) => l.label));
  assert.deepEqual(model.chapters.map((c) => c.level), [1, 2, 3, 4, 5]);
  assert.equal(model.summary.length, 5);
  assert.equal(model.overview.metrics.length, 5);
});

test('5.4 演示数据：报告首页指标与 golden 偏差 <= 0.01，封面注明演示数据', () => {
  const model = buildReportModel(demoCtx());
  const m = Object.fromEntries(model.overview.metrics.map((x) => [x.key, x.value]));
  assertClose(m.current_total, golden.channel.current_total, 'current_total');
  assertClose(m.diff, golden.channel.diff, 'diff');
  assertClose(m.growth_rate, golden.channel.growth_rate, 'growth_rate');
  assertClose(m.same_store_growth, golden.store_mix.same_store_growth, 'same_store_growth');
  assertClose(m.new_store_share, golden.store_mix.new_store_current / golden.store_mix.total_current, 'new_store_share');
  assert.equal(model.cover.sourceType, 'demo');
  assert.match(model.cover.sourceText, /演示数据/);
  assert.deepEqual(model.cover.period, { base: '2024-09', current: '2025-09' });
});

test('5.4 结论汇总与各章结论 = 看板各层 insights 原文', () => {
  const ctx = demoCtx();
  const model = buildReportModel(ctx);
  LEVELS.forEach((level, i) => {
    assert.equal(model.chapters[i].insight, ctx.result.insights[level.insightKey]);
    assert.equal(model.summary[i].insight, ctx.result.insights[level.insightKey]);
    assert.ok(model.summary[i].insight.length > 5);
  });
  assert.equal(model.overview.insight, ctx.result.insights.overview);
});

test('5.4 导入数据：封面显示文件名，指标随导入数据变化', () => {
  const s = demoSheets();
  s['渠道'][1][colIndex(s['渠道'], '本期收入')] = '500';
  const r = importWorkbook(s);
  const ctx = { data: r.data, result: analyze(r.data), dataset: { source: { type: 'import', fileName: 'a.xlsx' }, meta: r.meta } };
  const model = buildReportModel(ctx);
  assert.equal(model.cover.sourceText, '导入数据：a.xlsx');
  const total = model.overview.metrics.find((x) => x.key === 'current_total');
  assertClose(total.value, 1040, 'current_total');
  assert.equal(total.value, ctx.result.channel.current_total);
});

test('5.4 口径注释：折算时品类与客流章节出现同店折算注释，否则不出现', () => {
  const plain = buildReportModel(demoCtx());
  const hasDerived = (model, id) => model.chapters.find((c) => c.id === id).notes.some((n) => /折算/.test(n) && /同店销量/.test(n));
  assert.equal(hasDerived(plain, 'category'), false);
  assert.equal(hasDerived(plain, 'traffic'), false);
  assert.ok(plain.chapters.find((c) => c.id === 'traffic').notes.some((n) => /元/.test(n) && /万元/.test(n)));

  const ctx = demoCtx();
  ctx.dataset.meta = { derived: [{ field: 'same_store_current_qty', sheet: '品类', items: ['肉类'] }] };
  const derived = buildReportModel(ctx);
  assert.equal(derived.derived, true);
  assert.equal(hasDerived(derived, 'category'), true);
  assert.equal(hasDerived(derived, 'traffic'), true);
});
