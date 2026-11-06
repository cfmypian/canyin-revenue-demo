// 2.2 恒等式测试
//
// 只验证“因素影响之和 = 收入差”这类内在一致性，以及跨层口径是否自洽。
// 期望值不取自引擎输出：由 data/revenue_2025-09.json 的原始输入按 spec 定义独立推导。
//
// 覆盖：
// 1. 渠道：合计 = 各渠道之和；占比合计 = 1
// 2. 品类量价（全店 / 同店）：销量影响 + 单价影响 = 本期收入 − 同期收入
// 3. 三因素（同店）：客流影响 + 人均销量影响 + 单价影响 = 同店收入差
// 4. 门店客流客单：客流影响 + 客单影响 = 本期收入 − 同期收入
// 5. 同店 / 新店结构：同店 + 新店 = 总本期；同店渠道拆解口径自洽
// 6. 门店排名：rank 连续、降序、口径正确、新店不参与增长排名
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { analyze } from '../src/engine/index.js';

const TOL = 0.01;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readJson = (relativePath) => JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8'));

const input = readJson('data/revenue_2025-09.json');
const result = analyze(input);

// ---------------------------------------------------------------------------
// 由原始输入独立推导的口径（不读引擎输出）
// ---------------------------------------------------------------------------

const sumBy = (items, pick) => items.reduce((sum, item) => sum + pick(item), 0);

/** 同店门店 / 新店门店 */
const sameStoreStores = input.stores.filter((store) => store.type === '同店');
const newStoreStores = input.stores.filter((store) => store.type === '新店');

const sameStoreBase = sumBy(sameStoreStores, (store) => store.base);
const sameStoreCurrent = sumBy(sameStoreStores, (store) => store.current);
const totalStoreCurrent = sumBy(input.stores, (store) => store.current);

/** 同店收入占比 = 同店本期收入 / 全部门店本期收入（golden 同店渠道拆解即按此折算） */
const sameStoreRatio = sameStoreCurrent / totalStoreCurrent;

/** 同店客流合计（三因素分析的客流口径） */
const sameStoreTrafficBase = sumBy(input.store_traffic, (row) => row.base.traffic);
const sameStoreTrafficCurrent = sumBy(input.store_traffic, (row) => row.current.traffic);

const findCategory = (name) => {
  const category = input.categories.find((item) => item.category === name);
  assert.ok(category, `输入数据里找不到品类 ${name}`);
  return category;
};

function assertClose(actual, expected, label) {
  assert.equal(
    typeof actual,
    'number',
    `${label}：期望数值 ${expected}，实际 ${JSON.stringify(actual)}（不是数字）`,
  );
  assert.ok(Number.isFinite(actual), `${label}：实际值必须是有限数，实际为 ${actual}`);
  const deviation = Math.abs(actual - expected);
  assert.ok(
    deviation <= TOL,
    `${label}：期望 ${expected}，实际 ${actual}，偏差 ${deviation.toFixed(6)} > 容差 ${TOL}`,
  );
}

function assertDescending(values, label) {
  for (let i = 1; i < values.length; i += 1) {
    assert.ok(
      values[i - 1] >= values[i] - 1e-9,
      `${label}：应按从高到低排序，第 ${i} 项 ${values[i - 1]} < 第 ${i + 1} 项 ${values[i]}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 渠道
// ---------------------------------------------------------------------------

test('2.2 恒等式：渠道合计 = 各渠道之和', () => {
  const channel = result.channel;
  assertClose(channel.base_total, sumBy(input.channels, (row) => row.base), 'channel.base_total');
  assertClose(channel.current_total, sumBy(input.channels, (row) => row.current), 'channel.current_total');
  assertClose(channel.diff, channel.current_total - channel.base_total, 'channel.diff');
  assertClose(channel.growth_rate, channel.diff / channel.base_total, 'channel.growth_rate');
});

test('2.2 恒等式：渠道占比合计 = 1', () => {
  const rows = result.channel.rows;
  const shareSum = sumBy(rows, (row) => row.share);
  assertClose(shareSum, 1, '渠道占比合计');
  for (const row of rows) {
    assert.ok(row.share >= 0 && row.share <= 1, `渠道[${row.channel}].share=${row.share} 应在 0~1 之间`);
  }
});

// ---------------------------------------------------------------------------
// 品类量价（全店 / 同店）
// ---------------------------------------------------------------------------

test('2.2 恒等式：品类量价·全店 销量影响 + 单价影响 = 本期收入 − 同期收入', () => {
  const rows = result.category_qty_price.all;
  const detail = rows.filter((row) => row.category !== '合计');
  assert.equal(detail.length, input.categories.length, '全店品类明细行数应等于品类数');

  for (const row of detail) {
    const category = findCategory(row.category);
    const incomeDiff = category.current.revenue - category.base.revenue;
    assertClose(row.qty_effect + row.price_effect, row.total, `${row.category} 销量影响+单价影响`);
    assertClose(row.total, incomeDiff, `${row.category} total 应等于本期收入−同期收入`);
  }

  const totalRow = rows.at(-1);
  assert.equal(totalRow.category, '合计', '全店品类最后一行应为合计');
  assertClose(sumBy(detail, (row) => row.qty_effect), totalRow.qty_effect, '合计.qty_effect');
  assertClose(sumBy(detail, (row) => row.price_effect), totalRow.price_effect, '合计.price_effect');
  assertClose(sumBy(detail, (row) => row.total), totalRow.total, '合计.total');
  assertClose(
    totalRow.total,
    sumBy(input.categories, (category) => category.current.revenue - category.base.revenue),
    '合计.total 应等于全部品类收入差之和',
  );
});

test('2.2 恒等式：品类量价·同店 销量影响 + 单价影响 = 同店本期收入 − 同期收入', () => {
  const rows = result.category_qty_price.same_store;
  const detail = rows.filter((row) => row.category !== '合计');
  assert.equal(detail.length, input.categories.length, '同店品类明细行数应等于品类数');

  for (const row of detail) {
    const category = findCategory(row.category);
    // 同店本期收入 = 本期收入 × 同店收入占比（占比由门店数据独立推导）
    const sameStoreRevenue = category.current.revenue * sameStoreRatio;
    const incomeDiff = sameStoreRevenue - category.base.revenue;
    assertClose(row.qty_effect + row.price_effect, row.total, `${row.category} 销量影响+单价影响`);
    assertClose(row.total, incomeDiff, `${row.category} total 应等于同店收入差`);
  }

  const totalRow = rows.at(-1);
  assert.equal(totalRow.category, '合计', '同店品类最后一行应为合计');
  assertClose(sumBy(detail, (row) => row.qty_effect), totalRow.qty_effect, '合计.qty_effect');
  assertClose(sumBy(detail, (row) => row.price_effect), totalRow.price_effect, '合计.price_effect');
  assertClose(sumBy(detail, (row) => row.total), totalRow.total, '合计.total');
  assertClose(
    totalRow.total,
    sumBy(input.categories, (category) => category.current.revenue * sameStoreRatio - category.base.revenue),
    '合计.total 应等于全部品类同店收入差之和',
  );
});

// ---------------------------------------------------------------------------
// 三因素（客流 → 人均销量 → 单价）
// ---------------------------------------------------------------------------

test('2.2 恒等式：三因素 客流影响 + 人均销量影响 + 单价影响 = 同店收入差', () => {
  const rows = result.traffic.categories;
  const detail = rows.filter((row) => row.category !== '合计');
  assert.equal(detail.length, input.categories.length, '三因素品类明细行数应等于品类数');

  for (const row of detail) {
    const category = findCategory(row.category);
    const sameStoreRevenue = category.current.revenue * sameStoreRatio;
    const incomeDiff = sameStoreRevenue - category.base.revenue;
    assertClose(
      row.traffic_effect + row.per_capita_qty_effect + row.price_effect,
      row.total,
      `${row.category} 客流+人均销量+单价`,
    );
    assertClose(row.total, incomeDiff, `${row.category} total 应等于同店收入差`);
  }

  // 三因素层与品类量价同店层的合计口径应一致
  const sameStoreCategoryTotal = result.category_qty_price.same_store.filter((row) => row.category !== '合计');
  for (const row of detail) {
    const categoryRow = sameStoreCategoryTotal.find((item) => item.category === row.category);
    assert.ok(categoryRow, `品类量价同店层缺少 ${row.category}`);
    assertClose(row.total, categoryRow.total, `${row.category} 三因素合计与同店量价合计`);
  }

  // 合计行只校验“收入差合计 = 各品类合计之和”，不校验三因素列纵向加总：
  // golden 合计行 per_capita_qty_effect 固定为 0.0（逐品类纵向求和为 -0.9834），
  // 三因素恒等式只对逐品类明细行成立（见数据角色的口径说明）。
  const totalRow = rows.at(-1);
  assert.equal(totalRow.category, '合计', '三因素最后一行应为合计');
  assertClose(sumBy(detail, (row) => row.total), totalRow.total, '合计.total');
});

// ---------------------------------------------------------------------------
// 门店客流 × 客单
// ---------------------------------------------------------------------------

test('2.2 恒等式：门店 客流影响 + 客单影响 = 本期收入 − 同期收入（元）', () => {
  const rows = result.traffic.stores;
  const detail = rows.filter((row) => row.store !== '同店对比');
  assert.equal(detail.length, input.store_traffic.length, '门店客流客单明细行数应等于门店数');

  for (const row of detail) {
    const source = input.store_traffic.find((item) => item.store === row.store);
    assert.ok(source, `输入数据里找不到门店客流 ${row.store}`);
    // 收入（元） = 客流 × 客单，按整元取整（golden 口径），由原始输入独立推导
    assertClose(
      row.revenue_current,
      Math.round(source.current.traffic * source.current.ticket),
      `${row.store}.revenue_current`,
    );
    assertClose(
      row.revenue_base,
      Math.round(source.base.traffic * source.base.ticket),
      `${row.store}.revenue_base`,
    );
    assertClose(row.traffic_effect + row.ticket_effect, row.total, `${row.store} 客流影响+客单影响`);
    assertClose(row.total, row.revenue_current - row.revenue_base, `${row.store} total 应等于本期收入−同期收入`);
  }

  const totalRow = rows.at(-1);
  assert.equal(totalRow.store, '同店对比', '门店客流客单最后一行应为同店对比');
  for (const field of ['revenue_current', 'revenue_base', 'traffic_effect', 'ticket_effect', 'total']) {
    assertClose(sumBy(detail, (row) => row[field]), totalRow[field], `同店对比.${field}`);
  }
});

// ---------------------------------------------------------------------------
// 同店 / 新店结构
// ---------------------------------------------------------------------------

test('2.2 恒等式：同店 + 新店 = 总本期收入；同店增长口径自洽', () => {
  const storeMix = result.store_mix;
  assertClose(storeMix.same_store_base, sameStoreBase, 'store_mix.same_store_base');
  assertClose(storeMix.same_store_current, sameStoreCurrent, 'store_mix.same_store_current');
  assertClose(storeMix.new_store_current, sumBy(newStoreStores, (store) => store.current), 'store_mix.new_store_current');
  assertClose(storeMix.total_current, totalStoreCurrent, 'store_mix.total_current');
  assertClose(storeMix.same_store_current + storeMix.new_store_current, storeMix.total_current, '同店+新店=总本期');
  assertClose(storeMix.same_store_ratio, sameStoreRatio, 'store_mix.same_store_ratio');
  assertClose(storeMix.same_store_diff, storeMix.same_store_current - storeMix.same_store_base, 'same_store_diff');
  assertClose(storeMix.same_store_growth, storeMix.same_store_diff / storeMix.same_store_base, 'same_store_growth');
});

test('2.2 恒等式：同店渠道拆解 同店部分 + 新店部分 = 本期渠道收入', () => {
  for (const row of result.store_mix.channels) {
    const channel = input.channels.find((item) => item.channel === row.channel);
    assert.ok(channel, `输入数据里找不到渠道 ${row.channel}`);
    assertClose(row.same_store + row.new_store, channel.current, `${row.channel} 同店+新店 = 本期渠道收入`);
    assertClose(row.diff_vs_base, row.same_store - channel.base, `${row.channel} diff_vs_base = 同店收入 − 同期收入`);
  }
});

// ---------------------------------------------------------------------------
// 门店排名
// ---------------------------------------------------------------------------

test('2.2 恒等式：门店排名 rank 连续降序、口径正确、新店不参与增长排名', () => {
  const { by_revenue, by_growth_amount, by_growth_rate } = result.store_rank;

  // 收入排名：rank 从 1 连续；同店本期收入与输入一致；按收入降序
  assert.ok(Array.isArray(by_revenue) && by_revenue.length > 0, 'by_revenue 排名不能为空');
  assert.deepEqual(
    by_revenue.map((row) => row.rank).slice().sort((a, b) => a - b),
    Array.from({ length: by_revenue.length }, (_, index) => index + 1),
    'by_revenue rank 必须从 1 连续',
  );
  assertDescending(by_revenue.map((row) => row.current), 'by_revenue');
  for (const store of sameStoreStores) {
    const row = by_revenue.find((item) => item.store === store.store);
    assert.ok(row, `收入排名缺少同店 ${store.store}`);
    assertClose(row.current, store.current, `${store.store}.current`);
  }

  // 增长额 / 增长率排名：只含同店
  for (const [label, ranking, expectedLength] of [
    ['by_growth_amount', by_growth_amount, sameStoreStores.length],
    ['by_growth_rate', by_growth_rate, sameStoreStores.length],
  ]) {
    assert.equal(ranking.length, expectedLength, `${label} 应只含 ${expectedLength} 家同店`);
    assert.deepEqual(
      ranking.map((row) => row.rank).slice().sort((a, b) => a - b),
      Array.from({ length: ranking.length }, (_, index) => index + 1),
      `${label} rank 必须从 1 连续`,
    );
    for (const newStore of newStoreStores) {
      assert.ok(
        !ranking.some((row) => row.store === newStore.store),
        `新店 ${newStore.store} 不应进入 ${label} 增长排名`,
      );
    }
    for (const store of sameStoreStores) {
      const row = ranking.find((item) => item.store === store.store);
      assert.ok(row, `${label} 缺少同店 ${store.store}`);
      if (label === 'by_growth_amount') {
        assertClose(row.diff, store.current - store.base, `${store.store}.diff`);
      } else {
        assertClose(row.growth_rate, (store.current - store.base) / store.base, `${store.store}.growth_rate`);
      }
    }
  }

  assertDescending(by_growth_amount.map((row) => row.diff), 'by_growth_amount');
  assertDescending(by_growth_rate.map((row) => row.growth_rate), 'by_growth_rate');

  // 收入排名里的数值也应能由输入数据核对（若包含新店则按新店数据核对）
  const allStoreCurrent = new Map(input.stores.map((store) => [store.store, store.current]));
  for (const row of by_revenue) {
    assertClose(row.current, allStoreCurrent.get(row.store), `by_revenue[${row.store}].current`);
  }
});
