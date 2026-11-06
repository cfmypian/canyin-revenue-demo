// 2.3 边界测试
//
// 覆盖 spec 里的边界场景：
// 1. 某渠道同期收入为 0 时，增减率必须为空（null），不得是 0 / Infinity / NaN，也不得报错；
// 2. 负增长门店（门店12）、负增长品类（主食类）必须参与计算且数值正确；
// 3. 新店（同期 0）不进入增长排名。
//
// 真实数据用于验收基准相关断言；同时构造一份自洽的合成数据验证 0 基数场景。
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
const golden = readJson('data/golden_expected.json');
const result = analyze(input);

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

/** 递归检查输出里不允许出现 NaN / Infinity（null 表示“空”，是允许的） */
function assertNoNonFiniteNumbers(value, label = 'analyze()') {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${label} 出现非有限数：${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoNonFiniteNumbers(item, `${label}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assertNoNonFiniteNumbers(child, `${label}.${key}`);
    }
  }
}

/**
 * 构造一份自洽的最小合成数据（shape 与 data/revenue_2025-09.json 一致）。
 * 门店：同店 10→12 万，新店 0→5 万；同店收入占比 12/17（与 same_store_share 一致）。
 */
function makeSyntheticData(overrides = {}) {
  const sameStoreCurrent = 12;
  const totalStoreCurrent = 17;
  const sameStoreRatio = sameStoreCurrent / totalStoreCurrent;
  const categoryCurrentQty = 1200;

  const data = {
    period: { base: '2024-09', current: '2025-09' },
    same_store_share: sameStoreRatio,
    channels: [
      { channel: '老渠道', base: 20, current: 25 },
      { channel: '新渠道', base: 5, current: 10 },
    ],
    stores: [
      { region: '区域一', store: '合成同店1', type: '同店', base: 10, current: sameStoreCurrent },
      { region: '区域一', store: '合成新店1', type: '新店', base: 0, current: 5 },
    ],
    categories: [
      {
        category: '合成品类',
        base: { qty: 1000, revenue: 10 },
        current: { qty: categoryCurrentQty, revenue: 12 },
        same_store_current_qty: categoryCurrentQty * sameStoreRatio,
      },
    ],
    store_traffic: [
      {
        store: '合成同店1',
        base: { traffic: 100, ticket: 1000 },
        current: { traffic: 110, ticket: 120000 / 110 },
      },
    ],
  };

  return { ...data, ...overrides };
}

// ---------------------------------------------------------------------------
// 同期为 0：增减率为空
// ---------------------------------------------------------------------------

test('2.3 边界：渠道同期为 0 时增减率为 null（不是 0 / Infinity / NaN）', () => {
  const data = makeSyntheticData({
    channels: [
      { channel: '老渠道', base: 20, current: 25 },
      { channel: '同期为零渠道', base: 0, current: 10 },
    ],
  });
  const output = analyze(data);

  const zeroBaseRow = output.channel.rows.find((row) => row.channel === '同期为零渠道');
  assert.ok(zeroBaseRow, '渠道输出缺少 同期为零渠道 行');
  assert.equal(
    zeroBaseRow.growth_rate,
    null,
    `同期为 0 的渠道增减率必须是 null，实际为 ${JSON.stringify(zeroBaseRow.growth_rate)}`,
  );
  assert.notEqual(zeroBaseRow.growth_rate, 0, '同期为 0 的渠道增减率不得用 0 表示空');
  assert.notEqual(zeroBaseRow.growth_rate, Infinity, '同期为 0 的渠道增减率不得为 Infinity');
  assert.notEqual(zeroBaseRow.growth_rate, -Infinity, '同期为 0 的渠道增减率不得为 -Infinity');
  assert.ok(!Number.isNaN(zeroBaseRow.growth_rate), '同期为 0 的渠道增减率不得为 NaN');

  // 该渠道的差额仍按本期−同期正常计算
  assertClose(zeroBaseRow.diff, 10, '同期为零渠道.diff');
  assertClose(zeroBaseRow.base, 0, '同期为零渠道.base');
  assertClose(zeroBaseRow.current, 10, '同期为零渠道.current');

  // 同期非 0 的渠道与合计不受影响
  const normalRow = output.channel.rows.find((row) => row.channel === '老渠道');
  assert.ok(normalRow, '渠道输出缺少 老渠道 行');
  assertClose(normalRow.growth_rate, (25 - 20) / 20, '老渠道.growth_rate');
  assertClose(output.channel.base_total, 20, 'channel.base_total');
  assertClose(output.channel.current_total, 35, 'channel.current_total');
  assertClose(output.channel.growth_rate, (35 - 20) / 20, 'channel.growth_rate');

  // 0 基数场景下输出中不允许出现 Infinity / NaN
  assertNoNonFiniteNumbers(output, '同期为 0 渠道场景');
});

test('2.3 边界：合成数据整体计算结果无数值异常（NaN / Infinity）', () => {
  assertNoNonFiniteNumbers(analyze(makeSyntheticData()), '合成数据');
  assertNoNonFiniteNumbers(result, '真实数据');
});

// ---------------------------------------------------------------------------
// 负增长门店
// ---------------------------------------------------------------------------

test('2.3 边界：负增长门店 门店12 参与计算且数值正确', () => {
  const store12 = input.stores.find((store) => store.store === '门店12');
  assert.ok(store12, '输入数据缺少 门店12');

  const amountRow = result.store_rank.by_growth_amount.find((row) => row.store === '门店12');
  assert.ok(amountRow, '门店12 应参与增长额排名');
  assertClose(amountRow.diff, 56.1 - 59.23, '门店12.diff');

  const rateRow = result.store_rank.by_growth_rate.find((row) => row.store === '门店12');
  assert.ok(rateRow, '门店12 应参与增长率排名');
  assertClose(rateRow.growth_rate, (56.1 - 59.23) / 59.23, '门店12.growth_rate');
  assert.ok(rateRow.growth_rate < 0, `门店12 增长率为负，实际 ${rateRow.growth_rate}`);

  // 排名可由原始输入独立推导：按增长额/增长率从高到低排序
  const sameStoreStores = input.stores.filter((store) => store.type === '同店');
  const expectedAmountRank =
    [...sameStoreStores]
      .sort((a, b) => b.current - b.base - (a.current - a.base))
      .findIndex((store) => store.store === '门店12') + 1;
  const expectedRateRank =
    [...sameStoreStores]
      .sort((a, b) => (b.current - b.base) / b.base - (a.current - a.base) / a.base)
      .findIndex((store) => store.store === '门店12') + 1;
  assert.equal(amountRow.rank, expectedAmountRank, `门店12 增长额排名应为 ${expectedAmountRank}，实际 ${amountRow.rank}`);
  assert.equal(rateRow.rank, expectedRateRank, `门店12 增长率排名应为 ${expectedRateRank}，实际 ${rateRow.rank}`);

  // 客流客单：spec 场景 合计 -31,300 元，客流影响为负
  const trafficRow = result.traffic.stores.find((row) => row.store === '门店12');
  assert.ok(trafficRow, 'traffic.stores 缺少 门店12');
  assertClose(trafficRow.total, -31300, '门店12.total');
  assert.ok(trafficRow.traffic_effect < 0, `门店12 客流影响应为负，实际 ${trafficRow.traffic_effect}`);
  assertClose(trafficRow.revenue_current, 561000, '门店12.revenue_current');
  assertClose(trafficRow.revenue_base, 592300, '门店12.revenue_base');
});

// ---------------------------------------------------------------------------
// 负增长品类（主食类）
// ---------------------------------------------------------------------------

test('2.3 边界：负增长品类 主食类 参与计算且数值正确', () => {
  const allStoreRow = result.category_qty_price.all.find((row) => row.category === '主食类');
  assert.ok(allStoreRow, 'category_qty_price.all 缺少 主食类');
  assertClose(allStoreRow.total, -30.19, '主食类全店.total');
  assert.ok(allStoreRow.price_effect < 0, `主食类全店单价影响应为负，实际 ${allStoreRow.price_effect}`);

  const sameStoreRow = result.category_qty_price.same_store.find((row) => row.category === '主食类');
  assert.ok(sameStoreRow, 'category_qty_price.same_store 缺少 主食类');
  const goldenSameStoreRow = golden.samestore_category_qty_price.find((row) => row.category === '主食类');
  assert.ok(goldenSameStoreRow, 'golden 同店品类缺少 主食类');
  assertClose(sameStoreRow.qty_effect, goldenSameStoreRow.qty_effect, '主食类同店.qty_effect');
  assertClose(sameStoreRow.price_effect, goldenSameStoreRow.price_effect, '主食类同店.price_effect');
  assertClose(sameStoreRow.total, goldenSameStoreRow.total, '主食类同店.total');
  assert.ok(sameStoreRow.total < 0, `主食类同店合计应为负，实际 ${sameStoreRow.total}`);

  const trafficRow = result.traffic.categories.find((row) => row.category === '主食类');
  assert.ok(trafficRow, 'traffic.categories 缺少 主食类');
  assertClose(trafficRow.total, goldenSameStoreRow.total, '主食类三因素.total');
});

// ---------------------------------------------------------------------------
// 新店不参与增长排名
// ---------------------------------------------------------------------------

test('2.3 边界：新店不进入增长额 / 增长率排名（真实数据）', () => {
  const newStores = input.stores.filter((store) => store.type === '新店');
  const sameStoreCount = input.stores.filter((store) => store.type === '同店').length;
  assert.ok(newStores.length > 0, '真实数据里应包含新店');

  for (const [label, ranking] of [
    ['by_growth_amount', result.store_rank.by_growth_amount],
    ['by_growth_rate', result.store_rank.by_growth_rate],
  ]) {
    assert.equal(ranking.length, sameStoreCount, `${label} 应只含 ${sameStoreCount} 家同店`);
    for (const newStore of newStores) {
      assert.ok(
        !ranking.some((row) => row.store === newStore.store),
        `新店 ${newStore.store} 不应进入 ${label} 增长排名`,
      );
    }
  }
});

test('2.3 边界：合成数据中新店（同期 0）不进入增长排名', () => {
  const output = analyze(makeSyntheticData());
  for (const [label, ranking] of [
    ['by_growth_amount', output.store_rank.by_growth_amount],
    ['by_growth_rate', output.store_rank.by_growth_rate],
  ]) {
    assert.ok(
      !ranking.some((row) => row.store === '合成新店1'),
      `新店 合成新店1 不应进入 ${label} 增长排名`,
    );
    assert.equal(ranking.length, 1, `${label} 应只含 1 家同店`);
  }

  // 新店收入仍应计入同店/新店结构
  assertClose(output.store_mix.new_store_current, 5, 'store_mix.new_store_current');
  assertClose(output.store_mix.total_current, 17, 'store_mix.total_current');
});
