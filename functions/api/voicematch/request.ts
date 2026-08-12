// /api/voicematch/request — 가수추가 요청 공개 접수구.
// 어드민용 큐(admin/voicematch-requests, 같은 테이블)와 달리 시크릿 없이 받는다.
// 유저 제출은 source='user'로 표시되고, 로컬 파이프라인 cron이 pending을 그대로 드레인한다.
// 남용 방어: IP당 하루 3건 + pending 중복 거부. 검증 실패한 이름은 파이프라인이 failed로 마감한다.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function ensureTable(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS voicematch_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    done_at TEXT
  )`).run();
  // 기존 라이브 테이블에는 없는 컬럼 — 있으면 no-op으로 넘어간다
  for (const col of ['source TEXT', 'ip_hash TEXT']) {
    try { await db.prepare(`ALTER TABLE voicematch_requests ADD COLUMN ${col}`).run(); } catch { /* exists */ }
  }
}

async function sha256hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<{ DB: D1Database }> = async (ctx) => {
  await ensureTable(ctx.env.DB);
  const body = await ctx.request.json().catch(() => null) as { artist?: string } | null;
  const artist = (body?.artist || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (artist.length < 1) return Response.json({ error: 'artist required' }, { status: 400, headers: CORS });

  const ip = ctx.request.headers.get('cf-connecting-ip') || 'unknown';
  const ipHash = (await sha256hex('vmreq:' + ip)).slice(0, 16);

  const today = await ctx.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM voicematch_requests WHERE ip_hash=? AND created_at >= datetime('now','-1 day')"
  ).bind(ipHash).first<{ n: number }>();
  if ((today?.n || 0) >= 3) return Response.json({ error: 'rate limited' }, { status: 429, headers: CORS });

  const dup = await ctx.env.DB.prepare(
    "SELECT id FROM voicematch_requests WHERE lower(artist)=lower(?) AND status IN ('pending','processing')"
  ).bind(artist).first();
  if (dup) return Response.json({ error: 'already pending', id: dup.id }, { status: 409, headers: CORS });

  const r = await ctx.env.DB.prepare(
    "INSERT INTO voicematch_requests (artist, note, source, ip_hash) VALUES (?, 'user request', 'user', ?) RETURNING id"
  ).bind(artist, ipHash).first();
  return Response.json({ ok: true, id: (r as any)?.id }, { headers: CORS });
};
