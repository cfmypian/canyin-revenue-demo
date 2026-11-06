// 2.5 折算 golden 对比：删除「本期同店销量」列后导入，同店口径结果仍与 golden 一致
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyze, importWorkbook } from '../src/engine/index.js';
import { assertMatchesGolden, assertRowsClose, colIndex, demoSheets, golden } from './_import_helpers.js';

function importWithoutSameStoreQty() {
  const s = demoSheets();
  const i = colIndex(s['品类'], '本期同店销量');
  s['品类'].forEach((row) => row.splice(i, 1));
  return importWorkbook(s);
}

test('2.5 删除本期同店销量列：全部 8 个品类标记为折算', () => {
  const r = importWithoutSameStoreQty();
  assert.equal(r.ok, true);
  assert.equal(r.meta.derived[0].items.length, 8);
});

test('2.5 折算后同店品类量价与 golden 偏差 <= 0.01', () => {
  const result = analyze(importWithoutSameStoreQty().data);
  assertRowsClose(result.category_qty_price.same_store, golden.samestore_category_qty_price, 'category', 'same_store');
});

test('2.5 折算后客流 × 人均销量 × 单价三因素与 golden 偏差 <= 0.01', () => {
  const result = analyze(importWithoutSameStoreQty().data);
  assertRowsClose(result.traffic.categories, golden.traffic_percapita_price, 'category', 'traffic');
});

test('2.5 折算后 golden 全量仍一致', () => {
  assertMatchesGolden(analyze(importWithoutSameStoreQty().data));
});
