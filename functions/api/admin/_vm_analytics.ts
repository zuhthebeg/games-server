// 보이스매치 어드민 분석 집계 — 순수 함수 모듈.
// D1/Request에 의존하지 않아 node --test로 단위 테스트한다 (tests/voicematch-analytics.test.mjs).

export interface EntryRow { d: string; bs: string | null; cnt: number }
export interface CountryRow { country: string; cnt: number }
export interface DailyRow { d: string; user_id: string; artist: string; pct: number; updated_at: string | null }
export interface ArtistCntRow { artist: string; cnt: number }
export interface ReqStatusRow { status: string; cnt: number }
export interface ReqLatestRow { artist: string; status: string; created: string | null }
export interface EventRow { d: string; ev: string; loc: string; ref: string; n: number }

// /api/voicematch/event 화이트리스트와 동일. 보조 이벤트도 횟수만 집계한다 (VM-I12A).
export const EV_KEYS = ['visit', 'rec_start', 'analyze_done', 'result_view', 'share', 'login_tap', 'visit_return', 'newchip_tap', 'req_done_seen', 'daily_play', 'invite_open'] as const;
export type EvKey = typeof EV_KEYS[number];

export interface AnalyticsInput {
  generatedAt: string;
  today: string;              // YYYY-MM-DD (UTC)
  dayRange: string[];         // 오름차순 YYYY-MM-DD, 오늘 포함
  entryRows: EntryRow[];
  countryRows: CountryRow[];
  dailyRows: DailyRow[];      // dayRange + 리텐션용 직전 7일까지 커버
  rankingTop: ArtistCntRow[];
  rankedUsers: number;
  registeredRanked: number;
  voicematchSignups: number;
  requestStatus: ReqStatusRow[];
  requestLatest: ReqLatestRow[];
  eventRows: EventRow[];          // voicematch_events (day는 YYYY-MM-DD 정규형)
}

export function addDays(ymd: string, delta: number): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function lastNDays(endYmd: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(endYmd, -i));
  return out;
}

export function median(pcts: number[]): number | null {
  if (pcts.length === 0) return null;
  const s = [...pcts].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(v * 10) / 10;
}

function round1(v: number): number { return Math.round(v * 10) / 10; }

const BOT_KEYS = ['human', 'suspect', 'bot'] as const;

export function assembleAnalytics(input: AnalyticsInput) {
  const rangeSet = new Set(input.dayRange);

  // — 유입: signup_game='voicematch' 세션, bot_status별
  const entryMap = new Map<string, { human: number; suspect: number; bot: number; other: number }>();
  for (const d of input.dayRange) entryMap.set(d, { human: 0, suspect: 0, bot: 0, other: 0 });
  for (const r of input.entryRows) {
    const slot = entryMap.get(r.d);
    if (!slot) continue;
    const key = (BOT_KEYS as readonly string[]).includes(r.bs ?? '') ? (r.bs as 'human' | 'suspect' | 'bot') : 'other';
    slot[key] += r.cnt;
  }
  const entryDays = input.dayRange.map(d => {
    const s = entryMap.get(d)!;
    return { day: d, ...s, total: s.human + s.suspect + s.bot + s.other };
  });

  const countries = input.countryRows
    .filter(r => r.country)
    .sort((a, b) => b.cnt - a.cnt)
    .slice(0, 10)
    .map(r => ({ country: r.country, count: r.cnt }));

  // — 일일도전 (범위 내 행만)
  const inRange = input.dailyRows.filter(r => rangeSet.has(r.d));
  const byDay = new Map<string, DailyRow[]>();
  for (const r of inRange) {
    const arr = byDay.get(r.d) || [];
    arr.push(r);
    byDay.set(r.d, arr);
  }
  const daily = input.dayRange.map(d => {
    const rows = byDay.get(d) || [];
    const pcts = rows.map(r => r.pct);
    const sum = pcts.reduce((a, b) => a + b, 0);
    return {
      day: d,
      submissions: rows.length,
      uniqueSubmitters: new Set(rows.map(r => r.user_id)).size,
      avgPct: rows.length ? round1(sum / rows.length) : null,
      medianPct: median(pcts),
    };
  });

  // — 리텐션
  const daysPerUser = new Map<string, Set<string>>();
  for (const r of inRange) {
    const s = daysPerUser.get(r.user_id) || new Set<string>();
    s.add(r.d);
    daysPerUser.set(r.user_id, s);
  }
  const submitters = daysPerUser.size;
  let multiDayUsers = 0;
  for (const s of daysPerUser.values()) if (s.size >= 2) multiDayUsers++;

  const recent7 = new Set(lastNDays(input.today, 7));
  const prev7 = new Set(lastNDays(addDays(input.today, -7), 7));
  const recentUsers = new Set<string>();
  const prevUsers = new Set<string>();
  for (const r of input.dailyRows) {
    if (recent7.has(r.d)) recentUsers.add(r.user_id);
    else if (prev7.has(r.d)) prevUsers.add(r.user_id);
  }
  let returning = 0;
  for (const u of recentUsers) if (prevUsers.has(u)) returning++;

  // — 가수 Top10: 일별 1위(최고 pct, 동률 시 먼저 제출된 행)의 artist
  const wins = new Map<string, number>();
  for (const rows of byDay.values()) {
    const top = [...rows].sort((a, b) => b.pct - a.pct || (a.updated_at || '').localeCompare(b.updated_at || ''))[0];
    if (top) wins.set(top.artist, (wins.get(top.artist) || 0) + 1);
  }
  const dailyChampions = [...wins.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([artist, w]) => ({ artist, wins: w }));

  // — pct 히스토그램 (10단위, >=100은 마지막 칸)
  const buckets = Array.from({ length: 10 }, (_, i) => ({ label: i === 9 ? '90+' : `${i * 10}-${i * 10 + 9}`, count: 0 }));
  for (const r of inRange) {
    const i = Math.min(9, Math.max(0, Math.floor(r.pct / 10)));
    buckets[i].count++;
  }

  const byStatus: Record<string, number> = {};
  for (const r of input.requestStatus) byStatus[r.status] = r.cnt;

  // — 이벤트 퍼널 (VM-I10): 일별 ev 합계 + 기간 합계 + 유입처/로케일 분포
  // loc·ref는 방문자 속성이라 visit 이벤트 기준으로만 집계한다(전 이벤트 합산은 세션당 N배수라 분포가 왜곡됨)
  const zeroEv = (): Record<EvKey, number> => Object.fromEntries(EV_KEYS.map(ev => [ev, 0])) as Record<EvKey, number>;
  const evDayMap = new Map<string, ReturnType<typeof zeroEv>>();
  for (const d of input.dayRange) evDayMap.set(d, zeroEv());
  const evTotals = zeroEv();
  const locCnt = new Map<string, number>();
  const refCnt = new Map<string, number>();
  for (const r of input.eventRows) {
    if (!(EV_KEYS as readonly string[]).includes(r.ev)) continue;
    const slot = evDayMap.get(r.d);
    if (!slot) continue; // dayRange 밖
    slot[r.ev as EvKey] += r.n;
    evTotals[r.ev as EvKey] += r.n;
    if (r.ev === 'visit') {
      locCnt.set(r.loc, (locCnt.get(r.loc) || 0) + r.n);
      refCnt.set(r.ref, (refCnt.get(r.ref) || 0) + r.n);
    }
  }
  const funnel = {
    days: input.dayRange.map(d => ({ day: d, ...evDayMap.get(d)! })),
    totals: evTotals,
    byLoc: [...locCnt.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([loc, n]) => ({ loc, n })),
    byRef: [...refCnt.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([ref, n]) => ({ ref, n })),
  };

  return {
    generatedAt: input.generatedAt,
    days: input.dayRange.length,
    entry: { days: entryDays, countries },
    daily,
    retention: {
      submitters,
      multiDayUsers,
      multiDayRate: submitters ? round1((multiDayUsers / submitters) * 100) : null,
      recent7Submitters: recentUsers.size,
      returning,
      returningRate: recentUsers.size ? round1((returning / recentUsers.size) * 100) : null,
    },
    artists: {
      dailyChampions,
      rankingEntries: input.rankingTop.slice(0, 10).map(r => ({ artist: r.artist, count: r.cnt })),
    },
    pctBuckets: buckets,
    accounts: {
      rankedUsers: input.rankedUsers,
      registeredRanked: input.registeredRanked,
      voicematchSignups: input.voicematchSignups,
      attributionGap: true,
    },
    requests: {
      byStatus,
      latest: input.requestLatest.slice(0, 5).map(r => ({ artist: r.artist, status: r.status, created: r.created })),
    },
    funnel,
  };
}
