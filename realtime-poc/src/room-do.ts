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

interface Env {}

const DEFAULT_GAME = 'gostop'; // ?g= 미지정 구버전 gostop 클라 하위호환

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

    const game = await this.ctx.storage.get<any>('game');
    const live = game && !game.finished; // 끝난 게임은 좀비 — 재시작 대기 상태로 취급(로비 노출)
    server.send(JSON.stringify({ type: 'connected', user, started: !!live, connections: this.ctx.getWebSockets().length }));
    // 재연결: 진행 중이면 본인 시점 상태 즉시 복원(끝난 게임은 복원하지 않음 → 새 판 시작 가능)
    if (live && plugin) server.send(JSON.stringify({ type: 'state', view: plugin.getPlayerView(game, user) }));
    this.broadcast(JSON.stringify({ type: 'presence', event: 'join', user, connections: this.ctx.getWebSockets().length }), server);

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

    if (msg?.type === 'start') return this.handleStart(msg.config);
    if (msg?.type === 'action') return this.handleAction(user, msg.action, ws);
  }

  async handleStart(config: any): Promise<void> {
    const plugin = await this.getPlugin();
    let game = await this.ctx.storage.get<any>('game');
    if (game && !game.finished) {
      await this.pushViews(game, plugin); // 진행 중 → 뷰만 재전송(멱등)
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

    // 게임별 기본 config + 클라 전달 config 병합(클라 우선)
    const gameType = (await this.ctx.storage.get<string>('gameType')) || DEFAULT_GAME;
    const mergedConfig = { ...(getDefaultConfig(gameType) || {}), ...(config || {}) };
    game = plugin.createInitialState(players as any, mergedConfig);
    await this.ctx.storage.put('game', game);
    this.broadcast(JSON.stringify({ type: 'started', players: players.map((p) => p.id) }));
    await this.pushViews(game, plugin);
    await this.runAI(game, plugin);
  }

  async handleAction(user: string, action: any, ws: WebSocket): Promise<void> {
    const plugin = await this.getPlugin();
    let game = await this.ctx.storage.get<any>('game');
    if (!game) {
      ws.send(JSON.stringify({ type: 'error', error: '게임 미시작' }));
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
    await this.runAI(game, plugin);
  }

  // 빈 좌석(ai-*)이 현재 행동자면 DO가 자동 플레이. getAIAction 없는 PvP 게임은 스킵. 무한루프 방지 가드.
  async runAI(game: any, plugin: GamePlugin): Promise<void> {
    if (typeof plugin.getAIAction !== 'function') return; // PvP 게임(gomoku/connect4 등) — AI 자동플레이 없음
    let guard = 0;
    while (guard++ < 60 && !plugin.isGameOver(game)) {
      const turnId = plugin.getCurrentTurn(game);
      if (!turnId || !String(turnId).startsWith('ai-')) break;
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
