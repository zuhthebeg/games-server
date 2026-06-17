// CoordinatorDO — 싱글톤 레지스트리(idFromName('global')).
// RoomDO들이 라이프사이클(생성/갱신/종료/비움)을 보고 → 활성 방/게임별 카운트 집계.
// 용도 3개: ① 랜덤(빠른) 매칭(/match) ② 공개 방 목록(/rooms) ③ 어드민 메트릭(/stats).
// RoomDO→여기는 저빈도 이벤트(시작/종료/접속변화)만 보고 → DO-to-DO fetch, best-effort.

interface RoomRec {
  gameType: string;
  players: number;
  max: number;
  started: boolean;
  updatedAt: number;
}
interface Counter { created: number; finished: number; }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const json = (o: any, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...CORS } });

export class CoordinatorDO {
  ctx: DurableObjectState;
  constructor(ctx: DurableObjectState) { this.ctx = ctx; }

  async rooms(): Promise<Record<string, RoomRec>> {
    return (await this.ctx.storage.get<Record<string, RoomRec>>('rooms')) || {};
  }
  async counters(): Promise<Record<string, Counter>> {
    return (await this.ctx.storage.get<Record<string, Counter>>('counters')) || {};
  }

  async fetch(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/coord/, '') || '/';

    // RoomDO 보고(내부): { roomId, gameType, players, max, started, event }
    if (path === '/report' && req.method === 'POST') {
      const b = await req.json().catch(() => null) as any;
      if (!b || !b.roomId) return json({ ok: false }, 400);
      const rooms = await this.rooms();
      const counters = await this.counters();
      const gt = b.gameType || 'mp';
      counters[gt] = counters[gt] || { created: 0, finished: 0 };
      if (b.event === 'create') counters[gt].created++;
      if (b.event === 'finish') counters[gt].finished++;
      if (b.event === 'empty') {
        delete rooms[b.roomId];
      } else {
        rooms[b.roomId] = {
          gameType: gt,
          players: b.players | 0,
          max: b.max || 2,
          started: !!b.started,
          updatedAt: Date.now(),
        };
      }
      await this.ctx.storage.put('rooms', rooms);
      await this.ctx.storage.put('counters', counters);
      return json({ ok: true });
    }

    // 빠른 매칭: 해당 게임의 '열린' 방(시작 전 + 자리 남음) 중 가장 찬 방을 반환. 없으면 null(클라가 새로 생성).
    if (path === '/match') {
      const gt = url.searchParams.get('g') || 'mp';
      const rooms = await this.rooms();
      const open = Object.entries(rooms)
        .filter(([, r]) => r.gameType === gt && !r.started && r.players > 0 && r.players < r.max)
        .sort((a, b) => b[1].players - a[1].players);
      return json({ roomId: open.length ? open[0][0] : null });
    }

    // 공개 방 목록(열린 방). 어드민/로비 둘 다 사용.
    if (path === '/rooms') {
      const gt = url.searchParams.get('g');
      const rooms = await this.rooms();
      const list = Object.entries(rooms)
        .filter(([, r]) => (!gt || r.gameType === gt) && !r.started && r.players > 0 && r.players < r.max)
        .map(([roomId, r]) => ({ roomId, gameType: r.gameType, players: r.players, max: r.max }));
      return json({ rooms: list });
    }

    // 어드민 메트릭: 게임별 활성 방/플레이어/누적 생성·종료.
    if (path === '/stats') {
      const rooms = await this.rooms();
      const counters = await this.counters();
      const games: Record<string, any> = {};
      let totalActiveRooms = 0, totalPlayers = 0;
      for (const r of Object.values(rooms)) {
        const g = (games[r.gameType] = games[r.gameType] || { activeRooms: 0, players: 0, inProgress: 0, created: 0, finished: 0 });
        g.activeRooms++; g.players += r.players; if (r.started) g.inProgress++;
        totalActiveRooms++; totalPlayers += r.players;
      }
      for (const [gt, c] of Object.entries(counters)) {
        const g = (games[gt] = games[gt] || { activeRooms: 0, players: 0, inProgress: 0, created: 0, finished: 0 });
        g.created = c.created; g.finished = c.finished;
      }
      return json({ games, totalActiveRooms, totalPlayers, updatedAt: Date.now() });
    }

    return json({ ok: false, error: 'not found' }, 404);
  }
}
