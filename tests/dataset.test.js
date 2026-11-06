// 4.1 当前数据集管理：localStorage 持久化、重新校验、损坏回退演示数据（用内存 localStorage 模拟浏览器）
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { importWorkbook } from '../src/engine/index.js';
import { STORAGE_KEY, importedAtLabel, loadCurrentDataset, resetToDemo, saveImported, sourceLabel } from '../src/web/dataset.js';
import { colIndex, demo, demoSheets } from './_import_helpers.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

let storage;
beforeEach(() => {
  storage = memoryStorage();
  globalThis.window = { localStorage: storage };
});

const imported = () => {
  const s = demoSheets();
  s['渠道'][1][colIndex(s['渠道'], '本期收入')] = '500';
  return importWorkbook(s);
};

test('4.1 无本机数据：返回演示数据', () => {
  const ds = loadCurrentDataset(demo());
  assert.equal(ds.source.type, 'demo');
  assert.equal(ds.notice, null);
  assert.equal(sourceLabel(ds.source), '演示数据');
});

test('4.1 保存导入数据后再次读取（模拟刷新）仍为导入数据', () => {
  const r = imported();
  saveImported({ fileName: '九月数据.xlsx', data: r.data, meta: r.meta });
  assert.ok(storage.getItem(STORAGE_KEY));
  const ds = loadCurrentDataset(demo());
  assert.equal(ds.source.type, 'import');
  assert.equal(ds.source.fileName, '九月数据.xlsx');
  assert.equal(ds.data.channels[0].current, 500);
  assert.equal(sourceLabel(ds.source), '导入：九月数据.xlsx');
  assert.match(importedAtLabel(ds.source), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('4.1 折算标记随导入数据保存', () => {
  const s = demoSheets();
  s['品类'][1][colIndex(s['品类'], '本期同店销量')] = '';
  const r = importWorkbook(s);
  saveImported({ fileName: 'a.xlsx', data: r.data, meta: r.meta });
  assert.deepEqual(loadCurrentDataset(demo()).meta.derived[0].items, ['肉类']);
});

test('4.1 本机数据不是 JSON：回退演示数据、提示并清除', () => {
  storage.setItem(STORAGE_KEY, '{not json');
  const ds = loadCurrentDataset(demo());
  assert.equal(ds.source.type, 'demo');
  assert.equal(ds.notice, '本机导入数据已失效，已恢复演示数据');
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('4.1 本机数据结构不符合标准（校验失败）：回退演示数据', () => {
  const r = imported();
  r.data.stores = [];
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, source: { type: 'import', fileName: 'x' }, data: r.data }));
  const ds = loadCurrentDataset(demo());
  assert.equal(ds.source.type, 'demo');
  assert.ok(ds.notice);
});

test('4.1 版本不匹配：回退演示数据', () => {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, source: { type: 'import' }, data: demo() }));
  assert.equal(loadCurrentDataset(demo()).source.type, 'demo');
});

test('4.1 恢复演示数据：清除本机数据', () => {
  const r = imported();
  saveImported({ fileName: 'a.xlsx', data: r.data, meta: r.meta });
  const ds = resetToDemo(demo());
  assert.equal(ds.source.type, 'demo');
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(loadCurrentDataset(demo()).source.type, 'demo');
});

test('4.1 存储不可用：导入仍生效，提示刷新后回到演示数据', () => {
  storage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  const r = imported();
  const ds = saveImported({ fileName: 'a.xlsx', data: r.data, meta: r.meta });
  assert.equal(ds.source.type, 'import');
  assert.match(ds.notice, /刷新页面后将回到演示数据/);
});
