// /api/voicematch/group — 그룹 완성 모드 세션.
// 설계 정본: workspace docs/design/voicematch-group-mode.md
// 원칙: 서버에는 이름 문자열+싱크로율 숫자만 저장한다. 임베딩/음성은 클라를 떠나지 않는다.
//   클라가 로컬로 멤버별 유사도(pcts)를 계산해 보내면, 서버는 빈 슬롯 중 최고 멤버를 배정한다.
// GET  ?id=X            → 그룹 현황
// GET  ?rankings=bts    → 완성 팀 랭킹 top 20
// POST {action:'create', target, teamName}
// POST {action:'join', id, userName, pcts:{slug:pct}}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// 대상 그룹과 멤버 슬러그 — 클라 VM_GROUPS와 반드시 일치.
// 멤버는 전원 singers.json에 개인 임베딩으로 존재해야 한다(2026-08-19 rm_bts/suga/jin_bts/jisoo 수집).
const GROUPS: Record<string, string[]> = {
  bts: ['rm_bts', 'jin_bts', 'suga', 'jhope', 'jimin', 'v_bts', 'jungkook'],
  blackpink: ['jisoo', 'jennie', 'rose', 'lisa'],
};

async function ensureTables(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS vm_groups (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    team_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    ip_hash TEXT
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS vm_group_members (
    group_id TEXT NOT NULL,
    member_slug TEXT NOT NULL,
    user_name TEXT NOT NULL,
    pct INTEGER NOT NULL,
    all_pcts TEXT,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (group_id, member_slug)
  )`).run();
}

async function sha256hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randId() {
  const a = crypto.getRandomValues(new Uint8Array(6));
  return [...a].map(b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
}

const clampPct = (v: unknown) => Math.max(5, Math.min(99, Math.round(Number(v) || 0)));

async function groupState(db: D1Database, id: string) {
  const g = await db.prepare('SELECT id, target, team_name, status, completed_at FROM vm_groups WHERE id=?')
    .bind(id).first<{ id: string; target: string; team_name: string; status: string; completed_at: string | null }>();
  if (!g) return null;
  const rows = await db.prepare(
    'SELECT member_slug, user_name, pct FROM vm_group_members WHERE group_id=? ORDER BY joined_at'
  ).bind(id).all<{ member_slug: string; user_name: string; pct: number }>();
  const members = rows.results || [];
  const total = (GROUPS[g.target] || []).length;
  const teamScore = members.length ? Math.round(members.reduce((a, m) => a + m.pct, 0) / members.length) : 0;
  return {
    id: g.id, target: g.target, teamName: g.team_name, status: g.status,
    completedAt: g.completed_at, members, total, teamScore,
  };
}

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (ctx) => {
  await ensureTables(ctx.env.DB);
  const url = new URL(ctx.request.url);
  const id = url.searchParams.get('id');
  const rankTarget = url.searchParams.get('rankings');

  if (rankTarget) {
    if (!GROUPS[rankTarget]) return Response.json({ error: 'unknown target' }, { status: 400, headers: CORS });
    const rows = await ctx.env.DB.prepare(
      `SELECT g.team_name AS teamName, g.completed_at AS completedAt,
              ROUND(AVG(m.pct)) AS score, COUNT(m.member_slug) AS memberCount
         FROM vm_groups g JOIN vm_group_members m ON m.group_id = g.id
        WHERE g.target = ? AND g.status = 'complete'
        GROUP BY g.id ORDER BY score DESC, g.completed_at ASC LIMIT 20`
    ).bind(rankTarget).all();
    return Response.json({ target: rankTarget, rankings: rows.results || [] }, { headers: CORS });
  }

  if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: CORS });
  const st = await groupState(ctx.env.DB, id);
  if (!st) return Response.json({ error: 'not found' }, { status: 404, headers: CORS });
  return Response.json(st, { headers: CORS });
};

export const onRequestPost: PagesFunction<{ DB: D1Database }> = async (ctx) => {
  await ensureTables(ctx.env.DB);
  const body = await ctx.request.json().catch(() => null) as any;
  if (!body || typeof body !== 'object') return Response.json({ error: 'bad body' }, { status: 400, headers: CORS });

  if (body.action === 'create') {
    const target = String(body.target || '');
    if (!GROUPS[target]) return Response.json({ error: 'unknown target' }, { status: 400, headers: CORS });
    const teamName = String(body.teamName || '').trim().replace(/\s+/g, ' ').slice(0, 24) || 'TEAM';
    const ip = ctx.request.headers.get('cf-connecting-ip') || 'unknown';
    const ipHash = (await sha256hex('vmgrp:' + ip)).slice(0, 16);
    const today = await ctx.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM vm_groups WHERE ip_hash=? AND created_at >= datetime('now','-1 day')"
    ).bind(ipHash).first<{ n: number }>();
    if ((today?.n || 0) >= 10) return Response.json({ error: 'rate limited' }, { status: 429, headers: CORS });
    const id = randId();
    await ctx.env.DB.prepare('INSERT INTO vm_groups (id, target, team_name, ip_hash) VALUES (?,?,?,?)')
      .bind(id, target, teamName, ipHash).run();
    return Response.json({ id, target, teamName }, { headers: CORS });
  }

  if (body.action === 'join') {
    const id = String(body.id || '');
    const userName = String(body.userName || '').trim().replace(/\s+/g, ' ').slice(0, 16) || '?';
    const pctsIn = (body.pcts && typeof body.pcts === 'object') ? body.pcts : null;
    if (!id || !pctsIn) return Response.json({ error: 'id/pcts required' }, { status: 400, headers: CORS });

    const g = await ctx.env.DB.prepare('SELECT target, status FROM vm_groups WHERE id=?')
      .bind(id).first<{ target: string; status: string }>();
    if (!g) return Response.json({ error: 'not found' }, { status: 404, headers: CORS });
    const slots = GROUPS[g.target] || [];
    if (g.status === 'complete') return Response.json({ error: 'full' }, { status: 409, headers: CORS });

    const pcts: Record<string, number> = {};
    for (const s of slots) if (pctsIn[s] != null) pcts[s] = clampPct(pctsIn[s]);
    if (!Object.keys(pcts).length) return Response.json({ error: 'no valid pcts' }, { status: 400, headers: CORS });

    const taken = new Set(
      ((await ctx.env.DB.prepare('SELECT member_slug FROM vm_group_members WHERE group_id=?').bind(id)
        .all<{ member_slug: string }>()).results || []).map(r => r.member_slug)
    );
    // 빈 슬롯 중 내 pct가 가장 높은 멤버부터 배정. 동시 참여 레이스는 PK 충돌 시 차순위로 재시도.
    const order = slots.filter(s => !taken.has(s) && pcts[s] != null).sort((a, b) => pcts[b] - pcts[a]);
    if (!order.length) return Response.json({ error: 'full' }, { status: 409, headers: CORS });

    let assigned: string | null = null;
    for (const slot of order) {
      try {
        await ctx.env.DB.prepare(
          'INSERT INTO vm_group_members (group_id, member_slug, user_name, pct, all_pcts) VALUES (?,?,?,?,?)'
        ).bind(id, slot, userName, pcts[slot], JSON.stringify(pcts)).run();
        assigned = slot; break;
      } catch { /* PK 충돌 — 다음 슬롯 */ }
    }
    if (!assigned) return Response.json({ error: 'full' }, { status: 409, headers: CORS });

    const cnt = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM vm_group_members WHERE group_id=?')
      .bind(id).first<{ n: number }>();
    let completedNow = false;
    if ((cnt?.n || 0) >= slots.length) {
      await ctx.env.DB.prepare(
        "UPDATE vm_groups SET status='complete', completed_at=datetime('now') WHERE id=? AND status='open'"
      ).bind(id).run();
      completedNow = true;
    }
    const st = await groupState(ctx.env.DB, id);
    return Response.json({ ...st, assigned, assignedPct: pcts[assigned], completedNow }, { headers: CORS });
  }

  return Response.json({ error: 'unknown action' }, { status: 400, headers: CORS });
};
