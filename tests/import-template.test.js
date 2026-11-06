// 1.1 / 1.2 模板定义与 CSV 样例
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { DATA_SHEETS, SHEET_NAMES, denormalize, parseCSV } from '../src/engine/index.js';
import { ROOT, demo } from './_import_helpers.js';

test('1.1 模板包含 5 个 sheet：说明、渠道、门店、品类、门店客流', () => {
  assert.deepEqual(SHEET_NAMES, ['说明', '渠道', '门店', '品类', '门店客流']);
});

test('1.1 每张数据表列定义齐全，且主键列存在', () => {
  const expected = {
    渠道: ['渠道', '同期收入', '本期收入'],
    门店: ['区域', '门店', '门店类型', '同期收入', '本期收入'],
    品类: ['品类', '同期销量', '同期收入', '本期销量', '本期收入', '本期同店销量'],
    门店客流: ['门店', '同期客流', '同期客单', '本期客流', '本期客单'],
  };
  for (const sheet of DATA_SHEETS) {
    assert.deepEqual(sheet.columns.map((c) => c.label), expected[sheet.name], sheet.name);
    assert.ok(sheet.columns.some((c) => c.key === sheet.primaryKey), `${sheet.name} 主键列`);
  }
  const optional = DATA_SHEETS.flatMap((s) => s.columns.filter((c) => !c.required).map((c) => c.label));
  assert.deepEqual(optional, ['本期同店销量']);
});

test('1.1 表头带单位，说明 sheet 写明期间与单位', () => {
  const sheets = denormalize(demo());
  assert.equal(sheets['渠道'][0][1], '同期收入（万元）');
  assert.equal(sheets['门店客流'][0][2], '同期客单（元）');
  const intro = sheets['说明'].map((r) => r.join(' ')).join('\n');
  assert.match(intro, /同期月份 2024-09/);
  assert.match(intro, /本期月份 2025-09/);
  assert.match(intro, /万元/);
  assert.match(intro, /YYYY-MM/);
});

test('1.2 data/templates 下 CSV 样例存在，行数与演示数据一致', () => {
  const d = demo();
  const counts = { 渠道: d.channels.length, 门店: d.stores.length, 品类: d.categories.length, 门店客流: d.store_traffic.length };
  for (const [name, n] of Object.entries(counts)) {
    const file = path.join(ROOT, 'data/templates', `收入分析数据模板-${name}.csv`);
    assert.ok(existsSync(file), `缺少样例 ${file}`);
    const rows = parseCSV(readFileSync(file, 'utf8')).filter((r) => r.some((c) => c !== ''));
    assert.equal(rows.length - 1, n, `${name} 数据行数`);
  }
  assert.ok(existsSync(path.join(ROOT, 'data/templates/收入分析数据模板-说明.csv')));
});
