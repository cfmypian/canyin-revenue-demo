// 2.4 标准化：清洗格式、类型统一、同店占比、折算同店销量
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { importWorkbook } from '../src/engine/index.js';
import { colIndex, demo, demoSheets } from './_import_helpers.js';

test('2.4 清洗格式：" 1,234.5 " → 1234.5，全角数字也能识别，文本去首尾空格', () => {
  const s = demoSheets();
  s['渠道'][1][colIndex(s['渠道'], '本期收入')] = ' 1,234.5 ';
  s['渠道'][2][colIndex(s['渠道'], '本期收入')] = '３１６';
  s['渠道'][3][colIndex(s['渠道'], '渠道')] = '  线上活动优惠 ';
  const r = importWorkbook(s);
  assert.equal(r.ok, true, JSON.stringify(r.issues.errors));
  assert.equal(r.data.channels[0].current, 1234.5);
  assert.equal(r.data.channels[1].current, 316);
  assert.equal(r.data.channels[2].channel, '线上活动优惠');
});

test('2.4 输出标准结构顶层键，数值均为 number', () => {
  const r = importWorkbook(demoSheets());
  assert.deepEqual(Object.keys(r.data), ['period', 'same_store_share', 'channels', 'stores', 'categories', 'store_traffic']);
  for (const c of r.data.categories) {
    for (const v of [c.base.qty, c.base.revenue, c.current.qty, c.current.revenue, c.same_store_current_qty]) {
      assert.equal(typeof v, 'number');
    }
  }
});

test('2.4 same_store_share 由门店表推导（同店本期 / 全部本期，保留 3 位）', () => {
  const r = importWorkbook(demoSheets());
  assert.equal(r.data.same_store_share, 0.857);
  assert.ok(Math.abs(r.meta.same_store_ratio - 857.23 / 1000.23) < 1e-9);
});

test('2.4 本期同店销量为空：按本期销量 × 同店收入占比折算，并记入 meta.derived', () => {
  const s = demoSheets();
  const i = colIndex(s['品类'], '本期同店销量');
  s['品类'][1][i] = '';
  const r = importWorkbook(s);
  assert.equal(r.ok, true);
  assert.deepEqual(r.meta.derived, [{ field: 'same_store_current_qty', sheet: '品类', items: ['肉类'] }]);
  const meat = r.data.categories[0];
  assert.ok(Math.abs(meat.same_store_current_qty - 152127 * r.meta.same_store_ratio) < 1e-6);
  // 未清空的行保持原值
  assert.equal(r.data.categories[1].same_store_current_qty, demo().categories[1].same_store_current_qty);
});

test('2.4 不修改传入的表格', () => {
  const s = demoSheets();
  const before = JSON.stringify(s);
  importWorkbook(s);
  assert.equal(JSON.stringify(s), before);
});
