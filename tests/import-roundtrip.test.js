// 1.3 模板往返：denormalize(演示数据) → importWorkbook → analyze 与 golden 一致
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { analyze, importWorkbook, parseCSV, SHEET_NAMES, toCSV } from '../src/engine/index.js';
import { ROOT, assertMatchesGolden, demo, demoSheets } from './_import_helpers.js';

test('1.3 模板原样导入：零错误、零警告，与演示数据结构一致', () => {
  const r = importWorkbook(demoSheets());
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, { errors: [], warnings: [] });
  assert.deepEqual(r.meta.derived, []);
  const d = demo();
  for (const key of ['period', 'same_store_share', 'channels', 'stores', 'categories', 'store_traffic']) {
    assert.deepEqual(r.data[key], d[key], key);
  }
});

test('1.3 模板原样导入后 analyze 结果与 golden 偏差 <= 0.01', () => {
  assertMatchesGolden(analyze(importWorkbook(demoSheets()).data));
});

test('1.3 经 CSV 文本往返后仍与 golden 一致', () => {
  const sheets = Object.fromEntries(Object.entries(demoSheets()).map(([n, rows]) => [n, parseCSV(toCSV(rows))]));
  const r = importWorkbook(sheets);
  assert.equal(r.ok, true);
  assertMatchesGolden(analyze(r.data));
});

test('1.3 data/templates 下的 CSV 样例导入后与 golden 一致', () => {
  const sheets = Object.fromEntries(
    SHEET_NAMES.map((n) => [n, parseCSV(readFileSync(path.join(ROOT, 'data/templates', `收入分析数据模板-${n}.csv`), 'utf8'))]),
  );
  const r = importWorkbook(sheets);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assertMatchesGolden(analyze(r.data));
});
