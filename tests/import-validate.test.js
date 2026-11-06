// 2.2 / 2.3 数据校验：错误阻断、警告可继续
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ISSUE_CODES, formatIssue, importWorkbook } from '../src/engine/index.js';
import { colIndex, demoSheets } from './_import_helpers.js';

const codes = (list) => list.map((i) => i.code);
const run = (mutate) => {
  const sheets = demoSheets();
  mutate(sheets);
  return importWorkbook(sheets);
};

test('2.2 缺少 sheet：报错并阻断', () => {
  const r = run((s) => delete s['品类']);
  assert.equal(r.ok, false);
  assert.equal(r.data, null);
  const issue = r.issues.errors.find((i) => i.code === ISSUE_CODES.MISSING_SHEET);
  assert.equal(issue.message, '缺少 sheet：品类');
});

test('2.2 缺少说明 sheet / 期间未填 / 期间格式错误', () => {
  assert.ok(codes(run((s) => delete s['说明']).issues.errors).includes(ISSUE_CODES.MISSING_SHEET));
  assert.ok(codes(run((s) => (s['说明'][1][1] = '')).issues.errors).includes(ISSUE_CODES.MISSING_PERIOD));
  const bad = run((s) => (s['说明'][2][1] = '2025-13')).issues.errors.find((i) => i.code === ISSUE_CODES.INVALID_PERIOD);
  assert.equal(bad.column, '本期月份');
});

test('2.2 期间多种写法都能识别', () => {
  for (const v of ['2025/9', '2025.09', '2025年9月', '2025-09-01']) {
    const r = run((s) => (s['说明'][2][1] = v));
    assert.equal(r.ok, true, v);
    assert.equal(r.data.period.current, '2025-09', v);
  }
});

test('2.2 缺少必填列：报错；缺少可选列「本期同店销量」不报错', () => {
  const r = run((s) => {
    const i = colIndex(s['门店'], '门店类型');
    s['门店'].forEach((row) => row.splice(i, 1));
  });
  const issue = r.issues.errors.find((i) => i.code === ISSUE_CODES.MISSING_COLUMN);
  assert.equal(issue.sheet, '门店');
  assert.equal(issue.column, '门店类型');
  const ok = run((s) => {
    const i = colIndex(s['品类'], '本期同店销量');
    s['品类'].forEach((row) => row.splice(i, 1));
  });
  assert.equal(ok.ok, true);
});

test('2.2 没有数据行：报错', () => {
  const r = run((s) => (s['渠道'] = [s['渠道'][0]]));
  assert.ok(codes(r.issues.errors).includes(ISSUE_CODES.EMPTY_SHEET));
});

test('2.2 数值非法：渠道第 5 行本期收入为「四百」', () => {
  const r = run((s) => (s['渠道'][4][colIndex(s['渠道'], '本期收入')] = '四百'));
  assert.equal(r.ok, false);
  const issue = r.issues.errors.find((i) => i.code === ISSUE_CODES.NOT_NUMBER);
  assert.equal(formatIssue(issue), '渠道 · 第 5 行 · 本期收入：「四百」不是数字');
});

test('2.2 必填为空、负数、门店类型非法', () => {
  const r = run((s) => {
    s['门店'][2][colIndex(s['门店'], '区域')] = '  ';
    s['品类'][3][colIndex(s['品类'], '同期销量')] = '-5';
    s['门店'][4][colIndex(s['门店'], '门店类型')] = '老店';
  });
  const byCode = Object.fromEntries(r.issues.errors.map((i) => [i.code, i]));
  assert.deepEqual([byCode.REQUIRED.sheet, byCode.REQUIRED.row, byCode.REQUIRED.column], ['门店', 3, '区域']);
  assert.deepEqual([byCode.NEGATIVE.sheet, byCode.NEGATIVE.row], ['品类', 4]);
  assert.deepEqual([byCode.INVALID_ENUM.sheet, byCode.INVALID_ENUM.row], ['门店', 5]);
});

test('2.2 主键重复：门店3 出现两次，列出两处行号', () => {
  const r = run((s) => {
    const i = colIndex(s['门店'], '门店');
    const row = s['门店'].findIndex((x) => x[i] === '门店4');
    s['门店'][row][i] = '门店3';
  });
  const issue = r.issues.errors.find((x) => x.code === ISSUE_CODES.DUPLICATE_KEY);
  assert.equal(issue.sheet, '门店');
  assert.deepEqual(issue.rows, [4, 5]);
  assert.match(issue.message, /门店「门店3」重复（第 4、5 行）/);
});

test('2.2 跨表引用：门店客流中出现门店表不存在的门店', () => {
  const r = run((s) => (s['门店客流'][3][0] = '门店99'));
  const issue = r.issues.errors.find((x) => x.code === ISSUE_CODES.UNKNOWN_STORE);
  assert.equal(issue.sheet, '门店客流');
  assert.equal(issue.row, 4);
  assert.match(issue.message, /门店99/);
});

test('2.2 跨表引用：门店客流中出现新店', () => {
  const r = run((s) => (s['门店客流'][3][0] = '新店1'));
  assert.ok(codes(r.issues.errors).includes(ISSUE_CODES.TRAFFIC_NOT_SAME_STORE));
});

test('2.2 没有同店门店：报错', () => {
  const r = run((s) => {
    const i = colIndex(s['门店'], '门店类型');
    s['门店'].slice(1).forEach((row) => (row[i] = '新店'));
  });
  assert.ok(codes(r.issues.errors).includes(ISSUE_CODES.NO_SAME_STORE));
});

test('2.3 渠道合计与门店合计差异 > 1%：警告但可导入，显示两个合计', () => {
  const r = run((s) => (s['渠道'][1][colIndex(s['渠道'], '本期收入')] = '600'));
  assert.equal(r.ok, true);
  const w = r.issues.warnings.find((x) => x.code === ISSUE_CODES.TOTAL_MISMATCH);
  assert.ok(w);
  assert.match(w.message, /渠道本期合计 1140\.00 万元，门店本期合计 1000\.23 万元/);
});

test('2.3 差异在 1% 以内不警告（演示数据 1000 vs 1000.23）', () => {
  const r = run(() => {});
  assert.equal(r.issues.warnings.length, 0);
});

test('2.3 渠道同期为 0：不报错，给警告，增减率为空', async () => {
  const { analyze } = await import('../src/engine/index.js');
  const r = run((s) => (s['渠道'][1][colIndex(s['渠道'], '同期收入')] = '0'));
  assert.equal(r.ok, true);
  assert.equal(r.issues.errors.length, 0);
  assert.ok(codes(r.issues.warnings).includes(ISSUE_CODES.ZERO_BASE));
  const row = analyze(r.data).channel.rows.find((x) => x.channel === '美团大众');
  assert.equal(row.growth_rate, null);
});

test('2.3 新店同期为 0 属正常，不警告；同店缺客流给警告', () => {
  const r = run((s) => s['门店客流'].splice(1, 1));
  assert.equal(r.ok, true);
  const w = r.issues.warnings.filter((x) => x.code === ISSUE_CODES.ZERO_BASE);
  assert.equal(w.length, 0);
  assert.ok(r.issues.warnings.some((x) => x.code === ISSUE_CODES.SAME_STORE_NO_TRAFFIC && /门店1/.test(x.message)));
});
