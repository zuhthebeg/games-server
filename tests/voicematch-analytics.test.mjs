// _vm_analytics.ts 순수 함수 단위 테스트 — node --test tests/voicematch-analytics.test.mjs
// TS 소스를 esbuild로 빌드해 테스트 (D1/워커 환경 불필요)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(os.tmpdir(), `vm-analytics-${process.pid}.mjs`);
buildSync({
  entryPoints: [path.join(here, '../functions/api/admin/_vm_analytics.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});
const mod = await import(out);
const { assembleAnalytics, addDays, lastNDays, median } = mod;
process.on('exit', () => { try { fs.unlinkSync(out); } catch {} });

const TODAY = '2026-11-19';
const range14 = lastNDays(TODAY, 14); // 11-06 ~ 11-19

function baseInput(over = {}) {
  return {
    generatedAt: '2026-11-19T00:00:00Z',
    today: TODAY,
    dayRange: range14,
    entryRows: [],
    countryRows: [],
    dailyRows: [],
    rankingTop: [],
    rankedUsers: 0,
    registeredRanked: 0,
    voicematchSignups: 0,
    requestStatus: [],
    requestLatest: [],
    eventRows: [],
    ...over,
  };
}

test('lastNDays/addDays — UTC 날짜 목록', () => {
  assert.deepEqual(lastNDays('2026-11-19', 3), ['2026-11-17', '2026-11-18', '2026-11-19']);
  assert.equal(addDays('2026-11-19', -7), '2026-11-12');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('median — 빈 배열/홀수/짝수', () => {
  assert.equal(median([]), null);
  assert.equal(median([50]), 50);
  assert.equal(median([10, 90, 50]), 50);
  assert.equal(median([10, 20]), 15);
});

test('빈 데이터 — 날짜는 0으로 채워지고 비율은 null', () => {
  const r = assembleAnalytics(baseInput());
  assert.equal(r.daily.length, 14);
  assert.ok(r.daily.every(d => d.submissions === 0 && d.avgPct === null && d.medianPct === null));
  assert.ok(r.entry.days.every(d => d.total === 0));
  assert.equal(r.retention.multiDayRate, null);
  assert.equal(r.retention.returningRate, null);
  assert.deepEqual(r.entry.countries, []);
  assert.equal(r.accounts.attributionGap, true);
});

test('하루만 있는 데이터 — 집계·유입 분리·히스토그램', () => {
  const r = assembleAnalytics(baseInput({
    entryRows: [
      { d: TODAY, bs: 'human', cnt: 3 },
      { d: TODAY, bs: 'suspect', cnt: 2 },
      { d: TODAY, bs: 'bot', cnt: 5 },
      { d: TODAY, bs: null, cnt: 1 },
    ],
    dailyRows: [
      { d: TODAY, user_id: 'u1', artist: 'iu', pct: 95, updated_at: '2026-11-19 01:00:00' },
      { d: TODAY, user_id: 'u2', artist: 'bts', pct: 85, updated_at: '2026-11-19 02:00:00' },
      { d: TODAY, user_id: 'u3', artist: 'iu', pct: 40, updated_at: '2026-11-19 03:00:00' },
    ],
  }));
  const ed = r.entry.days.find(d => d.day === TODAY);
  assert.deepEqual(ed, { day: TODAY, human: 3, suspect: 2, bot: 5, other: 1, total: 11 });
  const dd = r.daily.find(d => d.day === TODAY);
  assert.equal(dd.submissions, 3);
  assert.equal(dd.uniqueSubmitters, 3);
  assert.equal(dd.avgPct, 73.3);
  assert.equal(dd.medianPct, 85);
  assert.deepEqual(r.artists.dailyChampions, [{ artist: 'iu', wins: 1 }]);
  assert.equal(r.pctBuckets[4].count, 1); // 40-49
  assert.equal(r.pctBuckets[8].count, 1); // 80-89
  assert.equal(r.pctBuckets[9].count, 1); // 90+
  // u1/u2/u3 모두 최근7일 신규, 직전7일엔 없음 → 재방문 0, multiDay 0
  assert.equal(r.retention.submitters, 3);
  assert.equal(r.retention.multiDayRate, 0);
  assert.equal(r.retention.returningRate, 0);
});

test('리텐션 — 2일 이상 제출 비율, 최근7일∩직전7일 재방문', () => {
  const r = assembleAnalytics(baseInput({
    dailyRows: [
      { d: TODAY, user_id: 'u1', artist: 'iu', pct: 90, updated_at: null },
      { d: '2026-11-18', user_id: 'u1', artist: 'iu', pct: 80, updated_at: null },
      { d: TODAY, user_id: 'u2', artist: 'bts', pct: 70, updated_at: null },
      { d: '2026-11-07', user_id: 'u2', artist: 'bts', pct: 60, updated_at: null }, // 직전7일(11-06~12)에도 제출
      { d: '2026-11-10', user_id: 'u3', artist: 'bts', pct: 60, updated_at: null }, // 직전7일에만
      { d: '2026-11-09', user_id: 'u1', artist: 'iu', pct: 55, updated_at: null },  // 직전7일에도 u1
    ],
  }));
  // 범위 내 제출자 u1,u2,u3 중 2일 이상 = u1,u2 → 2/3
  assert.equal(r.retention.submitters, 3);
  assert.equal(r.retention.multiDayUsers, 2);
  assert.equal(r.retention.multiDayRate, 66.7);
  // 최근7일(11-13~19) 제출자: u1,u2 → 2명, 둘 다 직전7일(11-06~12)에도 있음 → 재방문 2
  assert.equal(r.retention.recent7Submitters, 2);
  assert.equal(r.retention.returning, 2);
  assert.equal(r.retention.returningRate, 100);
});

test('일별 챔피언 — 동률이면 먼저 제출된 행이 우승', () => {
  const r = assembleAnalytics(baseInput({
    dailyRows: [
      { d: '2026-11-18', user_id: 'u1', artist: 'iu', pct: 90, updated_at: '2026-11-18 02:00:00' },
      { d: '2026-11-18', user_id: 'u2', artist: 'bts', pct: 90, updated_at: '2026-11-18 01:00:00' },
      { d: '2026-11-19', user_id: 'u1', artist: 'iu', pct: 88, updated_at: '2026-11-19 01:00:00' },
    ],
  }));
  assert.deepEqual(r.artists.dailyChampions, [
    { artist: 'bts', wins: 1 },
    { artist: 'iu', wins: 1 },
  ]);
});

test('accounts/requests — 필드 매핑과 Top10 절단', () => {
  const r = assembleAnalytics(baseInput({
    rankedUsers: 42, registeredRanked: 7, voicematchSignups: 3,
    rankingTop: Array.from({ length: 12 }, (_, i) => ({ artist: `a${i}`, cnt: 12 - i })),
    requestStatus: [{ status: 'pending', cnt: 2 }, { status: 'done', cnt: 9 }],
    requestLatest: Array.from({ length: 7 }, (_, i) => ({ artist: `r${i}`, status: 'pending', created: `c${i}` })),
  }));
  assert.deepEqual(r.accounts, { rankedUsers: 42, registeredRanked: 7, voicematchSignups: 3, attributionGap: true });
  assert.equal(r.artists.rankingEntries.length, 10);
  assert.deepEqual(r.requests.byStatus, { pending: 2, done: 9 });
  assert.equal(r.requests.latest.length, 5);
  assert.deepEqual(r.requests.latest[0], { artist: 'r0', status: 'pending', created: 'c0' });
});

test('범위 밖 데이터 무시 — entry/daily는 dayRange 밖 날짜 제외', () => {
  const r = assembleAnalytics(baseInput({
    entryRows: [{ d: '2026-11-01', bs: 'human', cnt: 9 }],
    dailyRows: [{ d: '2026-11-01', user_id: 'u9', artist: 'x', pct: 50, updated_at: null }],
  }));
  assert.equal(r.entry.days.reduce((a, d) => a + d.total, 0), 0);
  assert.equal(r.daily.reduce((a, d) => a + d.submissions, 0), 0);
  assert.equal(r.retention.submitters, 0);
});

// — VM-I10 이벤트 퍼널
test('funnel 빈 데이터 — 날짜는 0으로 채워지고 byLoc/byRef는 빈 배열', () => {
  const r = assembleAnalytics(baseInput());
  assert.equal(r.funnel.days.length, 14);
  assert.ok(r.funnel.days.every(d => d.visit === 0 && d.share === 0 && d.login_tap === 0));
  assert.equal(r.funnel.totals.visit, 0);
  assert.deepEqual(r.funnel.byLoc, []);
  assert.deepEqual(r.funnel.byRef, []);
});

test('funnel — 일별 ev 합계와 기간 totals', () => {
  const r = assembleAnalytics(baseInput({
    eventRows: [
      { d: '2026-11-18', ev: 'visit', loc: 'ko', ref: 'threads', n: 5 },
      { d: '2026-11-18', ev: 'visit', loc: 'tw', ref: 'threads', n: 3 },
      { d: '2026-11-18', ev: 'rec_start', loc: 'ko', ref: 'threads', n: 4 },
      { d: '2026-11-19', ev: 'visit', loc: 'ko', ref: 'direct', n: 2 },
      { d: '2026-11-19', ev: 'analyze_done', loc: 'ko', ref: 'threads', n: 1 },
      { d: '2026-11-19', ev: 'share', loc: 'ko', ref: 'threads', n: 1 },
      { d: '2026-11-19', ev: 'login_tap', loc: 'en', ref: 'google', n: 7 },
    ],
  }));
  const d18 = r.funnel.days.find(d => d.day === '2026-11-18');
  const d19 = r.funnel.days.find(d => d.day === '2026-11-19');
  assert.equal(d18.visit, 8);
  assert.equal(d18.rec_start, 4);
  assert.equal(d18.analyze_done, 0);
  assert.equal(d19.visit, 2);
  assert.equal(d19.analyze_done, 1);
  assert.equal(d19.login_tap, 7);
  assert.deepEqual(r.funnel.totals, { visit: 10, rec_start: 4, analyze_done: 1, result_view: 0, share: 1, login_tap: 7 });
});

test('funnel — byLoc/byRef는 visit만 집계, n 내림차순 정렬', () => {
  const r = assembleAnalytics(baseInput({
    eventRows: [
      { d: '2026-11-18', ev: 'visit', loc: 'tw', ref: 'threads', n: 3 },
      { d: '2026-11-18', ev: 'visit', loc: 'ko', ref: 'threads', n: 5 },
      { d: '2026-11-18', ev: 'visit', loc: 'ko', ref: 'direct', n: 1 },
      // 비-visit 이벤트의 loc/ref는 byLoc/byRef에 들어가지 않는다
      { d: '2026-11-18', ev: 'rec_start', loc: 'ja', ref: 'x', n: 99 },
      { d: '2026-11-19', ev: 'share', loc: 'es', ref: 'instagram', n: 50 },
    ],
  }));
  assert.deepEqual(r.funnel.byLoc, [{ loc: 'ko', n: 6 }, { loc: 'tw', n: 3 }]);
  assert.deepEqual(r.funnel.byRef, [{ ref: 'threads', n: 8 }, { ref: 'direct', n: 1 }]);
});

test('funnel — 화이트리스트 밖 ev와 범위 밖 날짜는 무시', () => {
  const r = assembleAnalytics(baseInput({
    eventRows: [
      { d: '2026-11-18', ev: 'hacked', loc: 'ko', ref: 'x', n: 100 },
      { d: '2026-11-01', ev: 'visit', loc: 'ko', ref: 'x', n: 100 },
    ],
  }));
  assert.equal(r.funnel.totals.visit, 0);
  assert.equal(r.funnel.days.every(d => d.visit === 0), true);
  assert.deepEqual(r.funnel.byRef, []);
});
