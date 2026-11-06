// 2.1 golden 对比测试
//
// 验收基准：data/golden_expected.json（只读，严禁修改，也不允许从引擎输出反推期望值）。
// 规则：golden 里出现的每一个数值都必须与 analyze() 输出逐项比对，偏差 <= 0.01。
//
// 约定：期望值只来自 golden_expected.json 与 openspec spec 场景，本文件不读取/推断引擎内部实现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { analyze } from '../src/engine/index.js';

const TOL = 0.01;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 读取 JSON（相对仓库根目录） */
const readJson = (relativePath) => JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8'));

/** 模拟输入数据（2024-09 同期 / 2025-09 本期） */
const input = readJson('data/revenue_2025-09.json');
/** 验收基准（只读） */
const golden = readJson('data/golden_expected.json');
/** 引擎输出，整个文件共用一次计算 */
const result = analyze(input);

/** 数值断言：偏差 <= 0.01，失败信息带期望/实际/偏差 */
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

/** 遍历 golden 标量对象的每个字段（自动覆盖每个数值，golden 新增字段时也会被比较） */
function assertScalarsMatch(actual, expected, label) {
  assert.ok(actual && typeof actual === 'object', `${label}：引擎输出缺失（期望字段 ${Object.keys(expected).join(', ')}）`);
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (field.startsWith('_')) continue;
    if (typeof expectedValue === 'number') {
      assertClose(actual[field], expectedValue, `${label}.${field}`);
    } else {
      assert.equal(actual[field], expectedValue, `${label}.${field}：期望 ${JSON.stringify(expectedValue)}，实际 ${JSON.stringify(actual[field])}`);
    }
  }
}

/**
 * 遍历 golden 数组的每一行、每一个字段做比对。
 * 行按 keyField（channel / category / store）对齐，不依赖数组顺序。
 */
function assertRowsMatch(actualRows, expectedRows, keyField, label) {
  assert.ok(Array.isArray(actualRows), `${label}：引擎输出不是数组`);
  assert.equal(
    actualRows.length,
    expectedRows.length,
    `${label}：行数不符，期望 ${expectedRows.length} 行，实际 ${actualRows.length} 行`,
  );
  for (const expectedRow of expectedRows) {
    const id = expectedRow[keyField];
    const actualRow = actualRows.find((row) => row && row[keyField] === id);
    assert.ok(actualRow, `${label}：引擎输出缺少 ${keyField}=${id} 的行`);
    for (const [field, expectedValue] of Object.entries(expectedRow)) {
      if (field === keyField || field.startsWith('_')) continue;
      if (typeof expectedValue === 'number') {
        assertClose(actualRow[field], expectedValue, `${label}[${id}].${field}`);
      } else {
        assert.equal(
          actualRow[field],
          expectedValue,
          `${label}[${id}].${field}：期望 ${JSON.stringify(expectedValue)}，实际 ${JSON.stringify(actualRow[field])}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// golden 全量对比（每个数值都必须覆盖）
// ---------------------------------------------------------------------------

test('2.1 golden：渠道合计（golden.channel）', () => {
  assertScalarsMatch(result.channel, golden.channel, 'channel');
  assert.ok(Array.isArray(result.channel.rows), 'channel.rows 应为数组');
});

test('2.1 golden：同店 / 新店结构（golden.store_mix）', () => {
  assertScalarsMatch(result.store_mix, golden.store_mix, 'store_mix');
  assert.equal(typeof result.store_mix.same_store_ratio, 'number', 'store_mix.same_store_ratio 应为数字');
});

test('2.1 golden：同店渠道拆解（golden.samestore_channel_current，10 个渠道）', () => {
  assertRowsMatch(result.store_mix.channels, golden.samestore_channel_current, 'channel', 'store_mix.channels');
});

test('2.1 golden：品类量价 · 全店（golden.category_qty_price，8 品类 + 合计）', () => {
  assertRowsMatch(result.category_qty_price.all, golden.category_qty_price, 'category', 'category_qty_price.all');
});

test('2.1 golden：品类量价 · 同店（golden.samestore_category_qty_price，8 品类 + 合计）', () => {
  assertRowsMatch(
    result.category_qty_price.same_store,
    golden.samestore_category_qty_price,
    'category',
    'category_qty_price.same_store',
  );
});

test('2.1 golden：客流 × 人均销量 × 单价三因素（golden.traffic_percapita_price，8 品类 + 合计）', () => {
  assertRowsMatch(result.traffic.categories, golden.traffic_percapita_price, 'category', 'traffic.categories');
});

test('2.1 golden：门店客流 × 客单两因素（golden.store_traffic_ticket_yuan，13 门店 + 同店对比，单位元）', () => {
  assertRowsMatch(result.traffic.stores, golden.store_traffic_ticket_yuan, 'store', 'traffic.stores');
});

// golden 顶层键 → 引擎输出位置。golden 新增基准项而测试没补断言时，本用例会失败。
const GOLDEN_MAPPING = {
  channel: (out) => out.channel,
  store_mix: (out) => out.store_mix,
  samestore_channel_current: (out) => out.store_mix.channels,
  category_qty_price: (out) => out.category_qty_price.all,
  samestore_category_qty_price: (out) => out.category_qty_price.same_store,
  traffic_percapita_price: (out) => out.traffic.categories,
  store_traffic_ticket_yuan: (out) => out.traffic.stores,
};

test('2.1 golden：基准文件每个顶层键都有对应断言（防漏项）', () => {
  const goldenKeys = Object.keys(golden)
    .filter((key) => !key.startsWith('_'))
    .sort();
  const mappedKeys = Object.keys(GOLDEN_MAPPING).sort();
  assert.deepEqual(
    goldenKeys,
    mappedKeys,
    'data/golden_expected.json 的顶层键与测试映射不一致：新增/删除基准项必须同步补断言',
  );
  for (const key of mappedKeys) {
    const actual = GOLDEN_MAPPING[key](result);
    assert.ok(actual !== undefined, `golden.${key} 映射到的引擎输出不存在`);
    if (Array.isArray(golden[key])) {
      assert.ok(Array.isArray(actual), `golden.${key} 是数组，引擎对应输出也应是数组`);
    } else {
      assert.ok(actual && typeof actual === 'object', `golden.${key} 是对象，引擎对应输出也应是对象`);
    }
  }
});

// ---------------------------------------------------------------------------
// 引擎输出契约（结构 / 合计行位置）
// ---------------------------------------------------------------------------

test('2.1 契约：analyze() 顶层结构与合计行位置', () => {
  for (const key of ['channel', 'store_mix', 'store_rank', 'category_qty_price', 'traffic', 'insights']) {
    assert.ok(key in result, `analyze() 输出缺少顶层键 ${key}`);
  }
  assert.equal(result.channel.rows.length, input.channels.length, 'channel.rows 应每渠道一行');
  assert.equal(
    result.store_mix.channels.length,
    golden.samestore_channel_current.length,
    'store_mix.channels 行数应与 golden 同店渠道拆解一致',
  );

  // 数组末尾的合计行
  assert.equal(result.category_qty_price.all.at(-1)?.category, '合计', 'category_qty_price.all 末尾应是合计行');
  assert.equal(
    result.category_qty_price.same_store.at(-1)?.category,
    '合计',
    'category_qty_price.same_store 末尾应是合计行',
  );
  assert.equal(result.traffic.categories.at(-1)?.category, '合计', 'traffic.categories 末尾应是合计行');
  assert.equal(result.traffic.stores.at(-1)?.store, '同店对比', 'traffic.stores 末尾应是同店对比行');

  // 明细行数 = 输入条数
  assert.equal(result.category_qty_price.all.length, input.categories.length + 1, '品类全店行数 = 品类数 + 合计');
  assert.equal(
    result.category_qty_price.same_store.length,
    input.categories.length + 1,
    '品类同店行数 = 品类数 + 合计',
  );
  assert.equal(result.traffic.categories.length, input.categories.length + 1, '三因素行数 = 品类数 + 合计');
  assert.equal(result.traffic.stores.length, input.store_traffic.length + 1, '门店客流客单行数 = 门店数 + 同店对比');
});

test('2.1 契约：insights 六个区块都是一句非空结论', () => {
  const insightKeys = ['overview', 'channel', 'store_mix', 'store_rank', 'category_qty_price', 'traffic'];
  for (const key of insightKeys) {
    assert.equal(typeof result.insights[key], 'string', `insights.${key} 应为字符串结论`);
    assert.ok(result.insights[key].trim().length > 0, `insights.${key} 不应为空`);
  }
});

// ---------------------------------------------------------------------------
// 渠道明细行（golden 只给合计，明细按输入数据 + 定义推导）
// ---------------------------------------------------------------------------

test('2.1 渠道明细行：同期/本期/同比差额/增减率/占比', () => {
  const rows = result.channel.rows;
  const currentTotal = input.channels.reduce((sum, channel) => sum + channel.current, 0);
  for (const channel of input.channels) {
    const row = rows.find((item) => item.channel === channel.channel);
    assert.ok(row, `channel.rows 缺少渠道 ${channel.channel}`);
    assertClose(row.base, channel.base, `channel[${channel.channel}].base`);
    assertClose(row.current, channel.current, `channel[${channel.channel}].current`);
    assertClose(row.diff, channel.current - channel.base, `channel[${channel.channel}].diff`);
    assertClose(
      row.growth_rate,
      (channel.current - channel.base) / channel.base,
      `channel[${channel.channel}].growth_rate`,
    );
    // 渠道结构占比按本期收入口径（与首屏“新店占比”一致）
    assertClose(row.share, channel.current / currentTotal, `channel[${channel.channel}].share`);
  }
});

// ---------------------------------------------------------------------------
// spec 场景（revenue-engine / revenue-dashboard 中 golden 未直接单列的部分）
// ---------------------------------------------------------------------------

test('spec 场景：渠道合计 759.56 / 1000 / +240.44 / 31.66%', () => {
  assertClose(result.channel.base_total, 759.56, 'channel.base_total');
  assertClose(result.channel.current_total, 1000, 'channel.current_total');
  assertClose(result.channel.diff, 240.44, 'channel.diff');
  assertClose(result.channel.growth_rate, 0.3166, 'channel.growth_rate');
});

test('spec 场景：同店本期 857.23 / 同期 759.95 / +97.28 / 12.8%，新店 143', () => {
  assertClose(result.store_mix.same_store_current, 857.23, 'store_mix.same_store_current');
  assertClose(result.store_mix.same_store_base, 759.95, 'store_mix.same_store_base');
  assertClose(result.store_mix.same_store_diff, 97.28, 'store_mix.same_store_diff');
  assertClose(result.store_mix.same_store_growth, 0.128, 'store_mix.same_store_growth');
  assertClose(result.store_mix.new_store_current, 143, 'store_mix.new_store_current');
});

test('spec 场景：美团大众同店 394.24 / +58.24 / 新店 65.76', () => {
  const row = result.store_mix.channels.find((item) => item.channel === '美团大众');
  assert.ok(row, 'store_mix.channels 缺少 美团大众');
  assertClose(row.same_store, 394.24, '美团大众.same_store');
  assertClose(row.diff_vs_base, 58.24, '美团大众.diff_vs_base');
  assertClose(row.new_store, 65.76, '美团大众.new_store');
});

test('spec 场景：增长额第一 门店7 +20.19，收入第一 门店3 91.45', () => {
  assert.equal(result.store_rank.by_growth_amount[0]?.store, '门店7', '增长额排名第一应为 门店7');
  assertClose(result.store_rank.by_growth_amount[0]?.diff, 20.19, 'by_growth_amount[0].diff');
  assert.equal(result.store_rank.by_revenue[0]?.store, '门店3', '收入排名第一应为 门店3');
  assertClose(result.store_rank.by_revenue[0]?.current, 91.45, 'by_revenue[0].current');
});

test('spec 场景：全店肉类 销量影响 133.06 / 单价影响 25.01 / 合计 158.07', () => {
  const row = result.category_qty_price.all.find((item) => item.category === '肉类');
  assert.ok(row, 'category_qty_price.all 缺少 肉类');
  assertClose(row.qty_effect, 133.06, '肉类全店.qty_effect');
  assertClose(row.price_effect, 25.01, '肉类全店.price_effect');
  assertClose(row.total, 158.07, '肉类全店.total');
});

test('spec 场景：同店主食类单价影响 -49.58 / 合计 -36.74（负向）', () => {
  const row = result.category_qty_price.same_store.find((item) => item.category === '主食类');
  assert.ok(row, 'category_qty_price.same_store 缺少 主食类');
  assertClose(row.price_effect, -49.58, '主食类同店.price_effect');
  assertClose(row.total, -36.74, '主食类同店.total');
});

test('spec 场景：肉类三因素 客流 47.21 / 人均销量 11.35 / 单价 21.44 / 合计 80.00', () => {
  const row = result.traffic.categories.find((item) => item.category === '肉类');
  assert.ok(row, 'traffic.categories 缺少 肉类');
  assertClose(row.traffic_effect, 47.21, '肉类.traffic_effect');
  assertClose(row.per_capita_qty_effect, 11.35, '肉类.per_capita_qty_effect');
  assertClose(row.price_effect, 21.44, '肉类.price_effect');
  assertClose(row.total, 80, '肉类.total');
});

test('spec 场景：门店1 客流影响 105882 / 客单影响 5618 / 合计 111500 元（spec 取整展示）', () => {
  const row = result.traffic.stores.find((item) => item.store === '门店1');
  assert.ok(row, 'traffic.stores 缺少 门店1');
  assert.equal(Math.round(row.traffic_effect), 105882, `门店1.traffic_effect 取整应等于 105882，实际 ${row.traffic_effect}`);
  assert.equal(Math.round(row.ticket_effect), 5618, `门店1.ticket_effect 取整应等于 5618，实际 ${row.ticket_effect}`);
  assert.equal(Math.round(row.total), 111500, `门店1.total 取整应等于 111500，实际 ${row.total}`);
});

test('spec 场景：首屏指标（本期 1000 万 / +240.44 / 31.66% / 同店 12.8% / 新店占比 14.3%）', () => {
  assertClose(result.channel.current_total, 1000, '首屏 本期收入');
  assertClose(result.channel.diff, 240.44, '首屏 同比差额');
  assertClose(result.channel.growth_rate, 0.3166, '首屏 增长率');
  assertClose(result.store_mix.same_store_growth, 0.128, '首屏 同店增长率');
  const newStoreShare = result.store_mix.new_store_current / result.store_mix.total_current;
  assertClose(newStoreShare, 0.143, '首屏 新店收入占比');
});
