// 导入测试共用工具：读演示数据、golden，构造模板表格，数值比对。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { denormalize } from '../src/engine/index.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const readJson = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
export const demo = () => readJson('data/revenue_2025-09.json');
export const golden = readJson('data/golden_expected.json');
export const TOL = 0.01;

/** 演示数据 → 模板表格（深拷贝，可随意修改）。 */
export const demoSheets = () => structuredClone(denormalize(demo()));

export function assertClose(actual, expected, label) {
  assert.ok(Number.isFinite(actual), `${label}：实际值 ${actual} 不是有限数`);
  assert.ok(Math.abs(actual - expected) <= TOL, `${label}：期望 ${expected}，实际 ${actual}`);
}

/** 按主键逐行逐字段比对 golden 数组。 */
export function assertRowsClose(actualRows, expectedRows, key, label) {
  assert.equal(actualRows.length, expectedRows.length, `${label}：行数不符`);
  for (const exp of expectedRows) {
    const act = actualRows.find((r) => r[key] === exp[key]);
    assert.ok(act, `${label}：缺少 ${exp[key]}`);
    for (const [f, v] of Object.entries(exp)) {
      if (typeof v === 'number') assertClose(act[f], v, `${label}[${exp[key]}].${f}`);
    }
  }
}

/** golden 全量对比（与 golden.test.js 同一映射）。 */
export function assertMatchesGolden(result) {
  for (const [f, v] of Object.entries(golden.channel)) if (typeof v === 'number') assertClose(result.channel[f], v, `channel.${f}`);
  for (const [f, v] of Object.entries(golden.store_mix)) if (typeof v === 'number') assertClose(result.store_mix[f], v, `store_mix.${f}`);
  assertRowsClose(result.store_mix.channels, golden.samestore_channel_current, 'channel', 'samestore_channel_current');
  assertRowsClose(result.category_qty_price.all, golden.category_qty_price, 'category', 'category_qty_price');
  assertRowsClose(result.category_qty_price.same_store, golden.samestore_category_qty_price, 'category', 'samestore_category_qty_price');
  assertRowsClose(result.traffic.categories, golden.traffic_percapita_price, 'category', 'traffic_percapita_price');
  assertRowsClose(result.traffic.stores, golden.store_traffic_ticket_yuan, 'store', 'store_traffic_ticket_yuan');
}

/** 取某 sheet 某列下标（按表头 label 前缀）。 */
export function colIndex(sheet, label) {
  const i = sheet[0].findIndex((h) => String(h).startsWith(label));
  assert.ok(i >= 0, `找不到列 ${label}`);
  return i;
}
