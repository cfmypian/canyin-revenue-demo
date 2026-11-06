// 2.1 CSV 解析与表头映射
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCSV, sheetNameFromFileName, toCSV } from '../src/engine/index.js';
import { normalizeHeader, parseSheets } from '../src/engine/import/index.js';
import { demoSheets } from './_import_helpers.js';

test('2.1 CSV：引号、引号内逗号与换行、"" 转义、BOM、CRLF', () => {
  const text = '\uFEFFa,b,c\r\n"x,1","he said ""hi""","line1\nline2"\r\n1,,3';
  assert.deepEqual(parseCSV(text), [
    ['a', 'b', 'c'],
    ['x,1', 'he said "hi"', 'line1\nline2'],
    ['1', '', '3'],
  ]);
});

test('2.1 CSV：保留空行，行号与表格软件一致', () => {
  assert.deepEqual(parseCSV('h\n\nv\n'), [['h'], [''], ['v']]);
});

test('2.1 CSV：toCSV 与 parseCSV 互逆', () => {
  const rows = [['名称', '值'], ['a,b', '1,234.5'], ['"q"', '']];
  assert.deepEqual(parseCSV(toCSV(rows)), rows);
});

test('2.1 表头归一化：全角括号、半角括号、空格、单位后缀', () => {
  for (const h of ['同期收入（万元）', '同期收入(万元)', ' 同期收入 ', '同期收入', '同期收入 （ 万元 ）']) {
    assert.equal(normalizeHeader(h), '同期收入', h);
  }
});

test('2.1 按列名映射，不依赖列顺序，忽略多余列；保留原始行号、跳过空行', () => {
  const sheets = demoSheets();
  sheets['渠道'] = [
    ['备注', '本期收入(万元)', ' 渠道 ', '同期收入'],
    ['x', '460', '美团大众', '336'],
    ['', '', '', ''],
    ['', '316', '扫码支付', '252'],
  ];
  const parsed = parseSheets(sheets);
  assert.deepEqual(parsed.sheets.channels.missingColumns, []);
  assert.deepEqual(parsed.sheets.channels.rows, [
    { row: 2, values: { channel: '美团大众', base: '336', current: '460' } },
    { row: 4, values: { channel: '扫码支付', base: '252', current: '316' } },
  ]);
});

test('2.1 sheet 名归一化匹配；读取说明 sheet 的期间', () => {
  const sheets = demoSheets();
  sheets[' 门店客流 '] = sheets['门店客流'];
  delete sheets['门店客流'];
  const parsed = parseSheets(sheets);
  assert.equal(parsed.sheets.store_traffic.found, true);
  assert.equal(parsed.period.base, '2024-09');
  assert.equal(parsed.period.current, '2025-09');
});

test('2.1 CSV 文件名推断 sheet：门店客流不会被识别为门店', () => {
  assert.equal(sheetNameFromFileName('收入分析数据模板-门店客流.csv'), '门店客流');
  assert.equal(sheetNameFromFileName('收入分析数据模板-门店.csv'), '门店');
  assert.equal(sheetNameFromFileName('品类.CSV'), '品类');
  assert.equal(sheetNameFromFileName('random.csv'), null);
});
