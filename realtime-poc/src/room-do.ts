// RoomDO — 방 1개 = 인스턴스 1개. Hibernatable WebSocket + server-authoritative.
//
// 핵심: 한 방의 모든 메시지를 이 DO 하나가 "한 번에 하나씩" 직렬 처리(동시 경합 없음).
//   start  → plugin.createInitialState(딜링) → 각 소켓에 본인 getPlayerView
//   action → validateAction(턴 가드 포함) → applyAction → events broadcast + 각자 view 갱신
//   (재)connect → 진행 중이면 본인 view 즉시 전송
//   빈 좌석은 ai-* 봇 → plugin.getAIAction이 있으면 DO가 자동 플레이(PvP 게임은 없음 → 스킵)
//
// 게임 로직은 games-server 공용 registry(getGame)에서 gameType별 plugin을 그대로 가져와 재사용(0 수정).
// gameType은 WS URL ?g= 로 전달, 방 생성 시 storage에 고정. 미지정이면 'gostop'(라이브 하위호환).
import { getGame, getDefaultConfig } from '../../functions/games/registry';
import type { GamePlugin } from '../../functions/games/types';

interface Env {
  COORD: DurableObjectNamespace; // 레지스트리(메트릭/방목록/매칭) 보고용
}

const DEFAULT_GAME = 'gostop'; // ?g= 미지정 구버전 gostop 클라 하위호환
const AI_MOVE_DELAY_MS = 850;  // AI 자동수 사이 페이싱 — 순삭 방지(마작/고스톱 등). 한 수 두기 전 대기.
const ZOMBIE_TTL_MS = 90_000;  // 방이 빈 뒤 이 시간 지나도 아무도 안 오면 storage 정리(좀비방).

export class RoomDO {
  ctx: DurableObjectState;
  env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  // 이 방의 gameType → plugin. storage에 고정된 값 우선, 없으면 기본(gostop).
  async getPlugin(): Promise<GamePlugin> {
    const gameType = (await this.ctx.storage.get<string>('gameType')) || DEFAULT_GAME;
    const plugin = getGame(gameType);
    if (!plugin) throw new Error(`unknown gameType: ${gameType}`);
    return plugin;
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') {
      const game = await this.ctx.storage.get('game');
      return Response.json({ ok: true, started: !!game, connections: this.ctx.getWebSockets().length });
    }

    const url = new URL(req.url);
    const user = (url.searchParams.get('u') || 'anon').slice(0, 40);
    const nick = (url.searchParams.get('n') || user).slice(0, 24);
    // 방 id를 경로(/room/:id)에서 캡처해 저장 — 코디네이터 보고에 필요(DO는 자기 이름을 모름).
    const ridM = url.pathname.match(/\/room\/([A-Za-z0-9_-]{1,64})/);
    if (ridM && !(await this.ctx.storage.get<string>('roomId'))) await this.ctx.storage.put('roomId', ridM[1]);
    // gameType 고정: 한 방의 정체성. 최초 연결 때 ?g= 로 정해지고 이후 불변.
    const reqGame = (url.searchParams.get('g') || '').slice(0, 32);
    let gameType = await this.ctx.storage.get<string>('gameType');
    if (!gameType) {
      gameType = reqGame || DEFAULT_GAME;
      await this.ctx.storage.put('gameType', gameType);
    }
    const plugin = getGame(gameType);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // tags[0]=user id(로스터/뷰 키), tags[1]=표시 닉네임. hibernation 넘어도 유지됨.
    this.ctx.acceptWebSocket(server, [user, nick]);

    // 누군가 들어왔으니 빈 방 정리 예약을 취소.
    try { await this.ctx.storage.deleteAlarm(); } catch {}
    // 호스트 = 이 방에 처음 연결한 유저(=방 생성자). 한 번 정해지면 고정(재접속해도 유지).
    const curHost = await this.ctx.storage.get<string>('hostUser');
    if (!curHost) await this.ctx.storage.put('hostUser', user);

    const game = await this.ctx.storage.get<any>('game');
    const live = game && !game.finished; // 끝난 게임은 좀비 — 재시작 대기 상태로 취급(로비 노출)
    server.send(JSON.stringify({ type: 'connected', user, started: !!live, connections: this.ctx.getWebSockets().length }));
    // 재연결: 진행 중이면 본인 시점 상태 즉시 복원(끝난 게임은 복원하지 않음 → 새 판 시작 가능)
    if (live && plugin?.relay) {
      // relay 게임: 서버에 게임상태 없음 → 저장된 호스트 스냅샷으로 resync(있을 때만).
      const snap = await this.ctx.storage.get<any>('lastSnapshot');
      if (snap != null) {
        const seq = (await this.ctx.storage.get<number>('seq')) ?? 0;
        server.send(JSON.stringify({ type: 'event', event: { seq, type: 'action', data: { type: '__resync', __snapshot: snap } } }));
      }
    } else if (live && plugin) {
      server.send(JSON.stringify({ type: 'state', view: plugin.getPlayerView(game, user) }));
    }
    this.broadcast(JSON.stringify({ type: 'presence', event: 'join', user, connections: this.ctx.getWebSockets().length }), server);
    await this.broadcastRoster(); // 로비 명단 갱신(이름+ready)
    await this.reportToCoord('update'); // 레지스트리에 방 등장/인원 보고

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const user = (this.ctx.getTags(ws)[0] as string) || 'anon';
    let msg: any;
    try {
      msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }

    if (msg?.type === 'profile') return this.handleProfile(user, msg.data);
    if (msg?.type === 'ready') return this.handleReady(user, !!msg.ready);
    if (msg?.type === 'roster') return void (await this.broadcastRoster()); // 클라가 명단 새로고침 요청
    if (msg?.type === 'start') return this.handleStart(msg.config);
    if (msg?.type === 'action') return this.handleAction(user, msg.action, ws);
  }

  // ===== 로비: 명단(roster) + 준비(ready) =====
  // 현재 연결된 소켓에서 유저 중복 제거(최초 순서=좌석). 끊긴 유저는 자동 제외.
  rosterPlayers(): { user: string; nick: string }[] {
    const seen = new Set<string>();
    const out: { user: string; nick: string }[] = [];
    for (const s of this.ctx.getWebSockets()) {
      const tags = this.ctx.getTags(s);
      const u = tags[0] as string;
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push({ user: u, nick: (tags[1] as string) || u });
    }
    return out;
  }

  async broadcastRoster(): Promise<void> {
    const ready = (await this.ctx.storage.get<Record<string, boolean>>('ready')) || {};
    const players = this.rosterPlayers().map(p => ({ ...p, ready: !!ready[p.user] }));
    // 호스트 = 방 생성자(저장값). 그 유저가 떠나 더 없으면 현재 첫 유저로 승계+저장.
    let host = await this.ctx.storage.get<string>('hostUser');
    if ((!host || !players.find(p => p.user === host)) && players.length) {
      host = players[0].user;
      await this.ctx.storage.put('hostUser', host);
    }
    const game = await this.ctx.storage.get<any>('game');
    this.broadcast(JSON.stringify({
      type: 'roster',
      players,
      hostUser: host || null, // 시작 버튼 권한 = 방 생성자
      connections: this.ctx.getWebSockets().length,
      started: !!(game && !game.finished),
    }));
  }

  // 코디네이터(레지스트리)에 방 상태 보고 — best-effort, 실패해도 방 동작엔 영향 없음.
  // event: 'update'(상태갱신) | 'create'(시작, created++) | 'finish'(종료, finished++) | 'empty'(방 제거)
  async reportToCoord(event: string): Promise<void> {
    try {
      const roomId = await this.ctx.storage.get<string>('roomId');
      if (!roomId || !this.env?.COORD) return;
      const gameType = (await this.ctx.storage.get<string>('gameType')) || DEFAULT_GAME;
      const plugin = getGame(gameType);
      const game = await this.ctx.storage.get<any>('game');
      const body = {
        roomId, gameType, event,
        players: this.rosterPlayers().length,
        max: (plugin && plugin.maxPlayers) || 2,
        started: !!(game && !game.finished),
      };
      const stub = this.env.COORD.get(this.env.COORD.idFromName('global'));
      await stub.fetch('https://coord/report', { method: 'POST', body: JSON.stringify(body) });
    } catch {}
  }

  async handleReady(user: string, ready: boolean): Promise<void> {
    const map = (await this.ctx.storage.get<Record<string, boolean>>('ready')) || {};
    if (ready) map[user] = true; else delete map[user];
    await this.ctx.storage.put('ready', map);
    await this.broadcastRoster();
  }

  // 플레이어별 프로필(무기 등) 등록 — start 전에 각 클라가 본인 데이터를 올린다.
  // PvP(enhance)처럼 시작 요청자 1명이 모든 플레이어의 데이터를 알 수 없는 경우에 필요.
  // 다른 게임(gostop 등)은 profile을 안 보내므로 영향 없음(additive).
  async handleProfile(user: string, data: any): Promise<void> {
    if (!user || data == null) return;
    const profiles = (await this.ctx.storage.get<Record<string, any>>('profiles')) || {};
    profiles[user] = data;
    await this.ctx.storage.put('profiles', profiles);
  }

  async handleStart(config: any): Promise<void> {
    const plugin = await this.getPlugin();
    let game = await this.ctx.storage.get<any>('game');
    if (game && !game.finished) {
      // 진행 중 재시작 요청(멱등): relay는 저장된 스냅샷 resync, 서버권위는 뷰 재전송.
      if (plugin.relay) {
        const snap = await this.ctx.storage.get<any>('lastSnapshot');
        const seq = (await this.ctx.storage.get<number>('seq')) ?? 0;
        if (snap != null) this.broadcast(JSON.stringify({ type: 'event', event: { seq, type: 'action', data: { type: '__resync', __snapshot: snap } } }));
      } else {
        await this.pushViews(game, plugin);
      }
      return;
    }
    // 끝난 게임(좀비)이 남아 있으면 새 판으로 리셋. seq도 초기화.
    if (game && game.finished) { await this.ctx.storage.delete('game'); await this.ctx.storage.put('seq', 0); game = null; }
    // 접속한 소켓들로 로스터 구성(유저 중복 제거, 좌석=순서)
    const seen = new Set<string>();
    const players: { id: string; nickname: string; seat: number }[] = [];
    for (const s of this.ctx.getWebSockets()) {
      const tags = this.ctx.getTags(s);
      const u = tags[0] as string;
      if (!u || seen.has(u)) continue;
      seen.add(u);
      players.push({ id: u, nickname: (tags[1] as string) || u, seat: players.length });
    }
    if (players.length === 0) return;
    // minPlayers 미달이면 시작 거부 — 1인 게임(gostop/mahjong/blackjack=AI패딩)은 통과,
    // 2인 PvP(pvp-battle 등)는 상대 접속 전 시작을 막아 'players:Array(1)' 깨진 판 방지.
    // ※ relay 게임(catan/pingtan)은 AI를 호스트 클라가 채우므로 DO는 소켓 수만으론 판단 못 함 →
    //    minPlayers 게이트를 스킵하고 호스트 클라의 시작 판단(AI 포함 canStart)을 신뢰한다.
    const minP = plugin.minPlayers || 1;
    if (!plugin.relay && players.length < minP) {
      this.broadcast(JSON.stringify({ type: 'start_rejected', reason: 'need_more_players', need: minP, have: players.length }));
      return;
    }

    // ===== relay 게임(catan/pingtan): 서버는 게임상태를 만들지 않는다 =====
    // 센티넬 game만 저장(live/roster의 started 플래그용). 초기상태는 호스트 클라가 빌드해
    // 첫 action(+__snapshot)으로 브로드캐스트 → 나머지 클라가 스냅샷으로 동기화.
    if (plugin.relay) {
      await this.ctx.storage.put('seq', 0);
      await this.ctx.storage.delete('lastSnapshot');
      game = { relay: true, finished: false, players: players.map((p) => ({ id: p.id, nickname: p.nickname, seat: p.seat })) };
      await this.ctx.storage.put('game', game);
      await this.ctx.storage.put('ready', {});
      this.broadcast(JSON.stringify({ type: 'started', players: players.map((p) => p.id), config: config || {} }));
      await this.reportToCoord('create');
      return;
    }

    // 게임별 기본 config + 클라 전달 config 병합(클라 우선)
    const gameType = (await this.ctx.storage.get<string>('gameType')) || DEFAULT_GAME;
    const mergedConfig = { ...(getDefaultConfig(gameType) || {}), ...(config || {}) };
    // 플레이어별 프로필(무기 등)을 playerData에 병합 — 시작 요청자가 못 채운 상대 데이터 보강.
    // config.playerData(요청자가 명시한 값)가 있으면 우선, 없으면 등록된 profile 사용.
    const profiles = (await this.ctx.storage.get<Record<string, any>>('profiles')) || {};
    if (Object.keys(profiles).length) {
      mergedConfig.playerData = { ...profiles, ...(mergedConfig.playerData || {}) };
    }
    game = plugin.createInitialState(players as any, mergedConfig);
    await this.ctx.storage.put('game', game);
    await this.ctx.storage.put('ready', {}); // 새 판 시작 → ready 초기화(재대결 로비 깨끗하게)
    this.broadcast(JSON.stringify({ type: 'started', players: players.map((p) => p.id) }));
    await this.pushViews(game, plugin);
    await this.reportToCoord('create'); // 레지스트리: 판 시작(created++ , started=true)
    await this.runAI(game, plugin);
  }

  async handleAction(user: string, action: any, ws: WebSocket): Promise<void> {
    const plugin = await this.getPlugin();
    let game = await this.ctx.storage.get<any>('game');
    if (!game) {
      ws.send(JSON.stringify({ type: 'error', error: '게임 미시작' }));
      return;
    }
    // ===== relay 게임: 룰 실행 없이 액션 통째를 순서대로 브로드캐스트 =====
    // 클라가 로컬 권위로 적용한 결과(+__snapshot)를 그대로 중계. relay.cocy.io 이벤트 형태와 일치.
    if (plugin.relay) {
      let seq = (await this.ctx.storage.get<number>('seq')) ?? 0;
      seq += 1;
      await this.ctx.storage.put('seq', seq);
      if (action && action.__snapshot != null) await this.ctx.storage.put('lastSnapshot', action.__snapshot); // 재접속 resync용
      // sender 포함 전체 브로드캐스트 — 수신측 dedup(actionId/seq)은 클라가 담당.
      this.broadcast(JSON.stringify({ type: 'event', event: { seq, type: 'action', data: action } }));
      return;
    }
    const v = plugin.validateAction(game, action, user);
    if (!v.valid) {
      // 턴 가드 등 거절 — 발신자에게만 (상태 변경 0)
      ws.send(JSON.stringify({ type: 'error', error: v.error || 'invalid', action }));
      return;
    }
    const res = plugin.applyAction(game, action, user);
    game = res.newState;
    await this.ctx.storage.put('game', game);
    await this.broadcastEvents(res.events);  // events BEFORE state — client captures DOM coords before re-render
    await this.pushViews(game, plugin);
    if (plugin.isGameOver(game)) await this.reportToCoord('finish'); // 레지스트리: 판 종료(finished++)
    await this.runAI(game, plugin);
  }

  // 빈 좌석(ai-*)이 현재 행동자면 DO가 자동 플레이. getAIAction 없는 PvP 게임은 스킵. 무한루프 방지 가드.
  async runAI(game: any, plugin: GamePlugin): Promise<void> {
    if (typeof plugin.getAIAction !== 'function') return; // PvP 게임(gomoku/connect4 등) — AI 자동플레이 없음
    let guard = 0;
    while (guard++ < 60 && !plugin.isGameOver(game)) {
      const turnId = plugin.getCurrentTurn(game);
      if (!turnId || !String(turnId).startsWith('ai-')) break;
      // AI가 한 수 두기 전 잠깐 대기 → 플레이어가 직전 상태를 볼 수 있게(순삭 방지).
      // 턴 가드 때문에 이 대기 중 인간 액션은 거절되므로 상태 레이스 없음.
      await new Promise((r) => setTimeout(r, AI_MOVE_DELAY_MS));
      const aiAction = plugin.getAIAction(game, turnId);
      const v = plugin.validateAction(game, aiAction, turnId);
      if (!v.valid) break;
      const res = plugin.applyAction(game, aiAction, turnId);
      game = res.newState;
      await this.ctx.storage.put('game', game);
      await this.broadcastEvents(res.events);  // events BEFORE state
      await this.pushViews(game, plugin);
    }
  }

  // 각 소켓에 "본인 시점" 상태 — 손패 프라이버시 보장
  async pushViews(game: any, plugin: GamePlugin): Promise<void> {
    for (const s of this.ctx.getWebSockets()) {
      const u = this.ctx.getTags(s)[0] as string;
      if (!u) continue;
      try {
        s.send(JSON.stringify({ type: 'state', view: plugin.getPlayerView(game, u) }));
      } catch {
        /* 끊긴 소켓 */
      }
    }
  }

  async broadcastEvents(events: any[]): Promise<void> {
    if (!events?.length) return;
    let seq = (await this.ctx.storage.get<number>('seq')) ?? 0;
    for (const ev of events) {
      seq += 1;
      this.broadcast(JSON.stringify({ type: 'event', seq, event: ev }));
    }
    await this.ctx.storage.put('seq', seq);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const user = (this.ctx.getTags(ws)[0] as string) || 'anon';
    const remaining = this.ctx.getWebSockets().filter((s) => s !== ws).length;
    this.broadcast(JSON.stringify({ type: 'presence', event: 'leave', user, connections: remaining }), ws);
    // 떠난 유저의 ready 해제 + 명단 갱신
    const map = (await this.ctx.storage.get<Record<string, boolean>>('ready')) || {};
    if (map[user]) { delete map[user]; await this.ctx.storage.put('ready', map); }
    await this.broadcastRoster();
    await this.reportToCoord('update'); // 레지스트리: 인원 변동 반영
    // 방이 비면 좀비 정리 예약 — ZOMBIE_TTL 후 아무도 안 돌아오면 storage 전체 삭제.
    if (remaining === 0) {
      try { await this.ctx.storage.setAlarm(Date.now() + ZOMBIE_TTL_MS); } catch {}
    }
  }

  // 빈 방 정리 알람: 예약 시점에 소켓 0이면 방 storage 전체 삭제(게임/프로필/ready/seq/gameType).
  // 그 사이 누가 재접속했으면 fetch()에서 deleteAlarm 했으므로 여기 안 옴.
  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length > 0) return; // 누가 돌아옴 → 보존
    await this.reportToCoord('empty'); // 레지스트리에서 방 제거(deleteAll 전에 roomId 읽어야 함)
    await this.ctx.storage.deleteAll();
  }

  broadcast(msg: string, except?: WebSocket): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(msg);
      } catch {
        /* ignore */
      }
    }
  }
}
