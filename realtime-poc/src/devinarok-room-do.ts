import {
  completeStage,
  createStageWorld,
  leaveStage,
  setPlayerConnected,
  step,
} from './devinarok/js/sim/world.js';
import { equipmentLook } from './devinarok/js/content/items.js';
import { isStageUnlocked } from './devinarok/js/content/stages.js';
import { decodeMessage, encodeMessage, PROTOCOL_VERSION } from './devinarok/js/net/protocol.js';
import { SIM_HASH } from './devinarok/js/net/sim-version.js';

const ROOM_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const TICK_MS = 1000 / 30;
const SNAPSHOT_INTERVAL = 2;
const FULL_INTERVAL = 30;
const MAX_EVENTS = 256;
const MAX_PENDING_INPUTS = 90;
const MAX_SNAPSHOT_BASELINES = 120;
const EVENT_RESEND_MS = 200;
const RECONNECT_MS = 60_000;

function playerAnimation(entity: any): string {
  if (entity.dead) return 'death';
  const skill = entity.skillCast?.name;
  if (skill === 'blink' || skill === 'vault') return 'dodge';
  if (skill === 'flame' || skill === 'frost') return 'Spellcast_Long';
  if (entity.family === 'crossbow' && (entity.attack || skill === 'pierce' || skill === 'volley')) {
    return entity.look?.weapon === '2H_Crossbow' ? '2H_Ranged_Shoot' : '1H_Ranged_Shoot';
  }
  if (entity.family === 'staff' && (entity.attack || skill)) return skill === 'flame' || skill === 'frost' ? 'Spellcast_Long' : 'Spellcast_Shoot';
  if (entity.family === 'sword' && skill === 'spin') return '1H_Melee_Attack_Slice_Diagonal';
  if (entity.family === 'sword' && skill === 'dash') return '1H_Melee_Attack_Chop';
  if (entity.family === 'sword' && entity.attack?.step) {
    return ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop'][entity.attack.step - 1];
  }
  return entity.moving ? 'run' : 'idle';
}

type Character = {
  level?: number;
  equipment?: unknown;
  potions?: number;
  clearedStages?: string[];
  [key: string]: unknown;
};

type PlayerRecord = {
  playerId: string;
  name: string;
  character: Character;
  connected: boolean;
  ready: boolean;
  joinedAt: number;
  order: number;
};

type RoomRecord = {
  players: PlayerRecord[];
  hostId: string | null;
  stageId: string;
  difficulty: string;
  nextOrder: number;
  public?: boolean;
};

type QueuedInput = {
  seq: number;
  moveX: number;
  moveZ: number;
  aim: number;
  ad?: number;
  buttons: number;
  viewTick?: number;
};

type InputState = {
  lastAppliedSeq: number;
  snapshotAck: number | null;
  pending: Map<number, QueuedInput>;
  forceFullResync: boolean;
};

type TokenRecord = {
  playerId: string;
  expiresAt: number | null;
};

function newRoom(): RoomRecord {
  return { players: [], hostId: null, stageId: 'C1', difficulty: 'normal', nextOrder: 0, public: true };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeCharacter(value: unknown): Character {
  const character = value && typeof value === 'object' ? value as Character : {};
  const equipment = Array.isArray(character.equipment) ? character.equipment : [];
  return {
    level: clamp(Math.trunc(Number(character.level) || 1), 1, 20),
    equipment,
    potions: clamp(Math.trunc(Number(character.potions) || 0), 0, 5),
    clearedStages: Array.isArray(character.clearedStages)
      ? character.clearedStages.filter((stage): stage is string => typeof stage === 'string')
      : [],
  };
}

function stageUnlocked(stageId: string, character: Character, difficulty = 'normal'): boolean {
  return isStageUnlocked(stageId, character.clearedStages ?? [], difficulty);
}

function normalizeInput(value: any): QueuedInput | null {
  if (!value || typeof value !== 'object') return null;
  const seq = Number(value?.seq);
  if (!Number.isSafeInteger(seq) || seq < 0) return null;
  const input: QueuedInput = {
    seq,
    moveX: clamp(Math.trunc(Number(value.mx) || 0), -127, 127),
    moveZ: clamp(Math.trunc(Number(value.mz) || 0), -127, 127),
    aim: clamp(Math.trunc(Number(value.aim) || 0), 0, 255),
    buttons: clamp(Math.trunc(Number(value.b) || 0), 0, 255),
  };
  if (Number.isFinite(value.ad)) input.ad = Math.max(0, Math.round(Number(value.ad) * 10) / 10);
  if (Number.isSafeInteger(value.vt)) input.viewTick = value.vt;
  return input;
}

function inputState(lastAppliedSeq = 0): InputState {
  return {
    lastAppliedSeq,
    snapshotAck: null,
    pending: new Map(),
    forceFullResync: false,
  };
}

function queueInput(state: InputState, input: QueuedInput): void {
  if (input.seq <= state.lastAppliedSeq || state.pending.has(input.seq)) return;
  state.pending.set(input.seq, input);
  while (state.pending.size > MAX_PENDING_INPUTS) {
    const oldest = Math.min(...state.pending.keys());
    state.pending.delete(oldest);
    state.lastAppliedSeq = Math.max(state.lastAppliedSeq, oldest);
    state.forceFullResync = true;
  }
}

function consumeInputsForTick(state: InputState): QueuedInput[] {
  const limit = state.pending.size > 2 ? 2 : 1;
  const consumed: QueuedInput[] = [];
  while (consumed.length < limit) {
    const nextSeq = state.lastAppliedSeq + 1;
    const next = state.pending.get(nextSeq);
    if (!next) break;
    state.pending.delete(nextSeq);
    state.lastAppliedSeq = nextSeq;
    consumed.push(next);
  }
  return consumed;
}

function socketPlayerId(socket: WebSocket): string | null {
  try {
    const attachment = (socket as any).deserializeAttachment?.();
    return typeof attachment?.playerId === 'string' ? attachment.playerId : null;
  } catch {
    return null;
  }
}

function setSocketPlayerId(socket: WebSocket, playerId: string): void {
  (socket as any).serializeAttachment?.({ playerId });
}

function closeSocket(socket: WebSocket, code = 1000, reason = ''): void {
  try {
    socket.close(code, reason);
  } catch {}
}

export class DevinarokRoomDO {
  private ctx: DurableObjectState;
  private env: any;
  private chain: Promise<void> = Promise.resolve();
  private tokens = new Map<string, TokenRecord>();
  private inputs = new Map<string, InputState>();
  private eventAcks = new Map<string, number>();
  private sentStatic = new Map<string, Set<number>>();
  private eventLastSent = new Map<string, Map<number, number>>();
  private snapshotBaselines = new Map<string, Map<number, Map<number, any>>>();
  private snapshotMetadataBaselines = new Map<string, Map<number, Record<string, any>>>();
  private world: any = null;
  private runId: string | null = null;
  private roomCode = '';
  private runEvents: any[] = [];
  private latestEventId = 0;
  private nextTickAt = 0;
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private lastDisconnectAt: number | null = null;
  private teleportPending = false;
  private finishingRun = false;

  constructor(ctx: DurableObjectState, env: unknown) {
    this.ctx = ctx;
    this.env = env;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn, fn);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readRoom(): Promise<RoomRecord> {
    const room = (await this.ctx.storage.get<RoomRecord>('lobby')) ?? newRoom();
    return { ...room, difficulty: room.difficulty ?? 'normal' };
  }

  private async writeRoom(room: RoomRecord): Promise<void> {
    await this.ctx.storage.put('lobby', room);
  }

  private send(socket: WebSocket, message: Record<string, unknown>): boolean {
    try {
      socket.send(encodeMessage(message));
      return true;
    } catch {}
    return false;
  }

  private sendError(socket: WebSocket, code: string): void {
    this.send(socket, { t: 'error', code });
    closeSocket(socket, 1008, code);
    void this.readRoom().then((room) => this.reportToCoord(room, 'update', socket)).catch(() => {});
  }

  private connectedSockets(playerId?: string, except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((socket) => (
      socket !== except &&
      (playerId === undefined || socketPlayerId(socket) === playerId) &&
      socketPlayerId(socket) !== null
    ));
  }

  private async broadcastLobby(room?: RoomRecord, except?: WebSocket): Promise<void> {
    const currentRoom = room ?? await this.readRoom();
    const connected = new Set(this.connectedSockets(undefined, except).map(socketPlayerId));
    for (const player of currentRoom.players) player.connected = connected.has(player.playerId);
    const players = currentRoom.players.map((player) => ({
      playerId: player.playerId,
      name: player.name,
      level: player.character.level ?? 1,
      family: equipmentLook(Array.isArray(player.character.equipment) ? player.character.equipment as any[] : []).family,
      ready: player.ready,
      connected: player.connected,
    }));
    const message = {
      t: 'lobby',
      players,
      hostId: currentRoom.hostId,
      stageId: currentRoom.stageId,
      difficulty: currentRoom.difficulty,
      public: currentRoom.public !== false,
    };
    for (const socket of this.connectedSockets(undefined, except)) this.send(socket, message);
    await this.writeRoom(currentRoom);
  }

  private async reportToCoord(room: RoomRecord, event: string, except?: WebSocket): Promise<void> {
    try {
      const coordinator = this.env?.COORD;
      if (!coordinator) return;
      const connected = new Set(this.connectedSockets(undefined, except).map(socketPlayerId).filter(Boolean));
      const host = room.players.find((player) => player.playerId === room.hostId);
      const isPublic = room.public !== false;
      const body = {
        roomId: `devinarok:${this.roomCode}`,
        gameType: 'devinarok',
        players: connected.size,
        max: 4,
        started: Boolean(this.world && !this.world.outcome),
        event: !connected.size || !isPublic ? 'empty' : event,
        meta: {
          code: this.roomCode,
          hostName: host?.name ?? '',
          stageId: room.stageId,
          difficulty: room.difficulty,
          hostLevel: host?.character.level ?? 1,
          public: isPublic,
        },
      };
      const stub = coordinator.get(coordinator.idFromName('global'));
      await stub.fetch('https://coord/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {}
  }

  private async handleHello(socket: WebSocket, message: any): Promise<void> {
    if (message.v !== PROTOCOL_VERSION || message.simHash !== SIM_HASH) {
      this.sendError(socket, 'version');
      return;
    }
    const room = await this.readRoom();
    const wasEmpty = room.players.length === 0;
    const now = Date.now();
    const token = typeof message.token === 'string' ? message.token : '';
    const activeRunId = await this.ctx.storage.get('activeRunId');
    if (activeRunId && (!this.world || this.world.outcome)) {
      this.sendError(socket, 'room-gone');
      return;
    }
    const tokenRecord = token ? this.tokens.get(token) : undefined;
    let player = tokenRecord && (tokenRecord.expiresAt === null || tokenRecord.expiresAt > now)
      ? room.players.find((entry) => entry.playerId === tokenRecord.playerId)
      : undefined;

    if (token && !player && this.world) {
      this.sendError(socket, 'room-gone');
      return;
    }
    if (player && this.connectedSockets(player.playerId).length) {
      for (const oldSocket of this.connectedSockets(player.playerId)) closeSocket(oldSocket, 4000, 'replaced');
    }
    if (!player) {
      if (this.world && !this.world.outcome) {
        this.sendError(socket, 'room-started');
        return;
      }
      if (room.players.length >= 4) {
        this.sendError(socket, 'room-full');
        return;
      }
      player = {
        playerId: crypto.randomUUID(),
        name: String(message.name ?? '영웅').trim().slice(0, 32) || '영웅',
        character: normalizeCharacter(message.character),
        connected: true,
        ready: false,
        joinedAt: now,
        order: room.nextOrder++,
      };
      room.players.push(player);
      if (!room.hostId) room.hostId = player.playerId;
      this.tokens.set(crypto.randomUUID(), { playerId: player.playerId, expiresAt: null });
    } else {
      player.name = String(message.name ?? player.name).trim().slice(0, 32) || player.name;
      player.character = normalizeCharacter(message.character ?? player.character);
      player.connected = true;
      this.tokens.set(token, { playerId: player.playerId, expiresAt: null });
    }

    const assignedToken = player === undefined
      ? ''
      : [...this.tokens.entries()].find(([, value]) => value.playerId === player!.playerId)?.[0] ?? '';
    if (!assignedToken) {
      this.sendError(socket, 'room-gone');
      return;
    }
    setSocketPlayerId(socket, player.playerId);
    await this.writeRoom(room);
    this.send(socket, {
      t: 'welcome',
      playerId: player.playerId,
      token: assignedToken,
      roomCode: this.roomCode,
      hostId: room.hostId,
    });
    await this.broadcastLobby(room);
    await this.reportToCoord(room, wasEmpty ? 'create' : 'update');
    try { await this.ctx.storage.deleteAlarm(); } catch {}

    if (this.world && !this.world.outcome) {
      setPlayerConnected(this.world, player.playerId, true);
      this.captureEvents();
      this.lastDisconnectAt = null;
      this.nextTickAt = Date.now() + TICK_MS;
      this.ensureInputState(player.playerId);
      this.startLoop();
      this.sendSnapshot(socket, player.playerId, true);
    } else if (this.world?.outcome && this.world.results[player.playerId]) {
      this.send(socket, { t: 'result', runId: this.runId, result: this.world.results[player.playerId] });
    } else if (await this.ctx.storage.get('activeRunId')) {
      this.sendError(socket, 'room-gone');
    }
  }

  private ensureInputState(playerId: string): InputState {
    let state = this.inputs.get(playerId);
    if (!state) {
      const player = this.world?.entities.find((entity: any) => (
        entity.kind === 'player' && entity.playerId === playerId
      ));
      state = inputState(player?.lastInput?.seq ?? 0);
      this.inputs.set(playerId, state);
    }
    return state;
  }

  private async handleLobbyMessage(playerId: string, message: any): Promise<void> {
    const room = await this.readRoom();
    const player = room.players.find((entry) => entry.playerId === playerId);
    if (!player) return;
    switch (message.t) {
      case 'lobby.ready':
        player.ready = Boolean(message.ready);
        break;
      case 'lobby.stage':
        if (playerId !== room.hostId || typeof message.stageId !== 'string') return;
        {
          const difficulty = typeof message.difficulty === 'string' ? message.difficulty : 'normal';
          if (!stageUnlocked(message.stageId, player.character, difficulty)) {
            const socket = this.connectedSockets(playerId)[0];
            if (socket) this.send(socket, { t: 'error', code: 'stage-locked' });
            return;
          }
          room.stageId = message.stageId;
          room.difficulty = difficulty;
        }
        break;
      case 'lobby.public':
        if (playerId !== room.hostId) {
          const socket = this.connectedSockets(playerId)[0];
          if (socket) this.send(socket, { t: 'error', code: 'host-only' });
          return;
        }
        room.public = Boolean(message.public);
        break;
      case 'lobby.start':
        if (playerId !== room.hostId) {
          const socket = this.connectedSockets(playerId)[0];
          if (socket) this.send(socket, { t: 'error', code: 'host-only' });
          return;
        }
        await this.startRun(room);
        return;
      default:
        return;
    }
    await this.writeRoom(room);
    await this.broadcastLobby(room);
    await this.reportToCoord(room, 'update');
  }

  private async startRun(room: RoomRecord): Promise<void> {
    const connected = room.players
      .filter((player) => player.connected && this.connectedSockets(player.playerId).length)
      .sort((a, b) => a.order - b.order);
    const host = room.players.find((player) => player.playerId === room.hostId);
    if (
      !connected.length ||
      connected.length !== room.players.length ||
      !host ||
      !connected.filter((player) => player.playerId !== host.playerId).every((player) => player.ready)
    ) {
      const socket = this.connectedSockets(room.hostId ?? undefined)[0];
      if (socket) this.send(socket, { t: 'error', code: 'not-ready' });
      return;
    }
    if (!stageUnlocked(room.stageId, host.character, room.difficulty)) {
      const socket = this.connectedSockets(room.hostId ?? undefined)[0];
      if (socket) this.send(socket, { t: 'error', code: 'stage-locked' });
      return;
    }
    if (this.world && !this.world.outcome) return;

    const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
    this.runId = crypto.randomUUID();
    this.world = createStageWorld({
      seed,
      stageId: room.stageId,
      difficulty: room.difficulty,
      inputDriven: true,
      party: connected.map((player) => ({
        playerId: player.playerId,
        name: player.name,
        character: player.character,
      })),
    });
    this.inputs.clear();
    this.eventAcks.clear();
    this.sentStatic.clear();
    this.eventLastSent.clear();
    this.snapshotBaselines.clear();
    this.snapshotMetadataBaselines.clear();
    this.runEvents = [];
    this.latestEventId = 0;
    this.teleportPending = false;
    this.finishingRun = false;
    for (const player of connected) {
      this.inputs.set(player.playerId, inputState());
      this.eventAcks.set(player.playerId, 0);
      this.sentStatic.set(player.playerId, new Set());
      player.ready = false;
    }
    room.players.forEach((player) => { player.ready = false; });
    this.captureEvents();
    await this.writeRoom(room);
    await this.ctx.storage.put('activeRunId', this.runId);
    await this.reportToCoord(room, 'update');
    const start = {
      t: 'start',
      runId: this.runId,
      seed,
      stageId: room.stageId,
      difficulty: room.difficulty,
      party: connected.map((player) => ({
        playerId: player.playerId,
        name: player.name,
        level: player.character.level ?? 1,
      })),
      tick: this.world.tick,
    };
    for (const socket of this.connectedSockets()) {
      const player = connected.find((entry) => entry.playerId === socketPlayerId(socket));
      if (!player) continue;
      this.send(socket, start);
      this.sendSnapshot(socket, player.playerId, true);
    }
    this.nextTickAt = Date.now() + TICK_MS;
    this.startLoop();
  }

  private async handleInput(playerId: string, message: any): Promise<void> {
    if (!this.world || this.world.outcome) return;
    const state = this.ensureInputState(playerId);
    if (Number.isSafeInteger(message.ae)) {
      const ack = Math.max(this.eventAcks.get(playerId) ?? 0, message.ae);
      this.eventAcks.set(playerId, ack);
      const sent = this.eventLastSent.get(playerId);
      if (sent) {
        for (const eventId of sent.keys()) {
          if (eventId <= ack) sent.delete(eventId);
        }
      }
    }
    if (Number.isSafeInteger(message.sa)) {
      state.snapshotAck = Math.max(state.snapshotAck ?? 0, message.sa);
    }
    if (message.sr === true) state.forceFullResync = true;
    if (!Array.isArray(message.inputs)) return;
    for (const raw of message.inputs) {
      const input = normalizeInput(raw);
      if (input) queueInput(state, input);
    }
  }

  private async handleLeave(socket: WebSocket, playerId: string): Promise<void> {
    const room = await this.readRoom();
    const playerIndex = room.players.findIndex((entry) => entry.playerId === playerId);
    if (playerIndex < 0) return;
    const player = room.players[playerIndex];
    if (this.world && !this.world.outcome) {
      const result = leaveStage(this.world, playerId);
      this.captureEvents();
      this.send(socket, { t: 'result', runId: this.runId, result });
      this.inputs.delete(playerId);
      this.eventAcks.delete(playerId);
      this.eventLastSent.delete(playerId);
      this.snapshotBaselines.delete(playerId);
      this.snapshotMetadataBaselines.delete(playerId);
      this.sentStatic.delete(playerId);
    }
    room.players.splice(playerIndex, 1);
    this.tokens.forEach((record, token) => {
      if (record.playerId === playerId) this.tokens.delete(token);
    });
    if (room.hostId === playerId) {
      room.hostId = room.players
        .filter((entry) => entry.connected)
        .sort((a, b) => a.order - b.order)[0]?.playerId ?? null;
    }
    await this.writeRoom(room);
    closeSocket(socket);
    await this.broadcastLobby(room, socket);
    await this.reportToCoord(room, 'update', socket);
    if (this.world?.outcome) await this.finishRun();
    else if (!room.players.some((entry) => entry.connected)) this.pauseForReconnect();
  }

  private async processMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let message: any;
    try {
      const frame = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      message = decodeMessage(frame);
    } catch {
      this.sendError(socket, 'bad-message');
      return;
    }
    const playerId = socketPlayerId(socket);
    if (!playerId) {
      if (message.t !== 'hello') {
        this.sendError(socket, 'hello-required');
        return;
      }
      await this.handleHello(socket, message);
      return;
    }
    if (message.t === 'hello') return;
    if (message.t === 'ping') {
      this.send(socket, { t: 'pong', c: message.c, tick: this.activeRunTick() });
    } else if (message.t === 'in') {
      await this.handleInput(playerId, message);
    } else if (
      message.t === 'lobby.ready' ||
      message.t === 'lobby.stage' ||
      message.t === 'lobby.public' ||
      message.t === 'lobby.start'
    ) {
      await this.handleLobbyMessage(playerId, message);
    } else if (message.t === 'leave') {
      await this.handleLeave(socket, playerId);
    }
  }

  private activeRunTick(): number {
    if (this.runId === null || !this.world || this.world.outcome) return 0;
    return this.world.tick;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.roomCode = url.pathname.split('/').at(-1) ?? '';
    if (!ROOM_CODE.test(this.roomCode)) return new Response('invalid room code', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') {
      const room = await this.readRoom();
      return Response.json({
        ok: true,
        roomCode: this.roomCode,
        players: room.players.length,
        started: Boolean(this.world && !this.world.outcome),
      });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.exclusive(() => this.processMessage(socket, message));
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.exclusive(async () => {
      try {
        const playerId = socketPlayerId(socket);
        if (!playerId || this.connectedSockets(playerId, socket).length) return;
        const room = await this.readRoom();
        const player = room.players.find((entry) => entry.playerId === playerId);
        if (player) {
          player.connected = false;
          await this.writeRoom(room);
        }
        if (this.world && !this.world.outcome) setPlayerConnected(this.world, playerId, false);
        this.tokens.forEach((record) => {
          if (record.playerId === playerId) record.expiresAt = Date.now() + RECONNECT_MS;
        });
        await this.broadcastLobby(room, socket);
        await this.reportToCoord(room, 'update', socket);
        if (!room.players.some((entry) => entry.connected)) this.pauseForReconnect();
      } finally {
        closeSocket(socket);
      }
    });
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  private pauseForReconnect(): void {
    this.clearLoop();
    if (this.world && !this.world.outcome) {
      this.lastDisconnectAt = Date.now();
      void this.ctx.storage.setAlarm(this.lastDisconnectAt + RECONNECT_MS);
    }
  }

  private startLoop(): void {
    if (this.loopTimer !== null || !this.world || this.world.outcome) return;
    this.nextTickAt = this.nextTickAt || Date.now() + TICK_MS;
    this.loopTimer = setInterval(() => this.pump(), TICK_MS);
  }

  private clearLoop(): void {
    if (this.loopTimer !== null) clearInterval(this.loopTimer);
    this.loopTimer = null;
  }

  private pump(): void {
    if (!this.world || this.world.outcome) {
      this.clearLoop();
      return;
    }
    const now = Date.now();
    let catchup = 0;
    while (now >= this.nextTickAt && catchup < 4) {
      this.stepWorld();
      this.nextTickAt += TICK_MS;
      catchup += 1;
      if (this.world.outcome) break;
    }
    if (this.world.outcome) {
      void this.finishRun();
      return;
    }
    if (catchup && this.world.tick % SNAPSHOT_INTERVAL === 0) {
      this.broadcastSnapshots(this.world.tick % FULL_INTERVAL === 0);
    }
  }

  private stepWorld(): void {
    if (!this.world) return;
    const inputs: Record<string, any> = {};
    const seen = new Set<string>();
    for (const socket of this.connectedSockets()) {
      const playerId = socketPlayerId(socket);
      if (!playerId || seen.has(playerId) || !this.world.players.some((id: number) => (
        this.world.entities.find((entity: any) => entity.id === id)?.playerId === playerId
      ))) continue;
      seen.add(playerId);
      const queuedInputs = consumeInputsForTick(this.ensureInputState(playerId));
      if (queuedInputs.length) {
        inputs[playerId] = queuedInputs.map((input) => ({
          seq: input.seq,
          moveX: input.moveX,
          moveZ: input.moveZ,
          aim: input.aim,
          ...(input.ad === undefined ? {} : { ad: input.ad }),
          buttons: input.buttons,
          ...(input.viewTick === undefined ? {} : { viewTick: input.viewTick }),
        }));
      }
    }
    step(this.world, inputs);
    this.captureEvents();
  }

  private captureEvents(): void {
    if (!this.world) return;
    const fresh = this.world.events.filter((event: any) => event.eventId > this.latestEventId);
    if (!fresh.length) return;
    this.runEvents.push(...fresh);
    this.latestEventId = fresh.at(-1).eventId;
    if (this.runEvents.length > MAX_EVENTS) this.runEvents.splice(0, this.runEvents.length - MAX_EVENTS);
    if (fresh.some((event: any) => event.type === 'roomEnter')) this.teleportPending = true;
  }

  private renderEntity(entity: any, playerId: string, full: boolean): Record<string, any> {
    const sent = this.sentStatic.get(playerId) ?? new Set<number>();
    this.sentStatic.set(playerId, sent);
    const includeStatic = full || !sent.has(entity.id);
    const rendered: Record<string, any> = {
      id: entity.id,
      kind: entity.kind,
      playerId: entity.playerId,
      family: entity.family,
      x: entity.x,
      z: entity.z,
      facing: entity.facing,
      hp: entity.hp,
      state: entity.downed ? 'downed' : entity.dead ? 'dead' : entity.attackPhase ?? 'idle',
      anim: entity.kind === 'player' ? playerAnimation(entity) : entity.dead ? 'death' : entity.moving ? 'run' : 'idle',
      dead: Boolean(entity.dead),
      invulnerable: Boolean(entity.invulnerable),
      spawnTicksLeft: entity.spawnTicksLeft ?? 0,
      attackPhase: entity.attackPhase ?? null,
      attackPattern: entity.attackPattern ?? null,
      attackShape: entity.attackShape ?? null,
      attackRemaining: entity.attackRemaining ?? 0,
      skill: entity.skillCast?.id ?? entity.skill ?? null,
      dodge: (entity.dodgeTicks ?? 0) > 0,
      downed: Boolean(entity.downed),
      ownerId: entity.ownerId,
      radius: entity.radius,
      slowTicks: entity.slowTicks ?? 0,
      ...(includeStatic ? {
        model: entity.model,
        maxHp: entity.maxHp,
        name: entity.name,
        item: entity.item,
        ...(entity.kind === 'player' ? {
          characterKind: entity.characterKind,
          family: entity.family,
          look: entity.look,
        } : {}),
      } : {}),
      ...(entity.kind === 'player' && entity.playerId === playerId ? {
        motion: structuredClone(entity),
        counterReadyTicks: entity.counterReadyTicks ?? 0,
        counterAttackerId: entity.counterAttackerId ?? null,
        perfectPaid: Boolean(entity.perfectPaid),
        dodgeStartTick: entity.dodgeStartTick ?? null,
      } : {}),
      teleport: Boolean(this.teleportPending),
      roomChanged: Boolean(this.teleportPending),
    };
    if (includeStatic) sent.add(entity.id);
    return rendered;
  }

  private eventsForSnapshot(playerId: string): any[] {
    const ack = this.eventAcks.get(playerId) ?? 0;
    const now = Date.now();
    const sent = this.eventLastSent.get(playerId) ?? new Map<number, number>();
    this.eventLastSent.set(playerId, sent);
    const events = this.runEvents.filter((event) => {
      if (event.eventId <= ack) return false;
      const lastSentAt = sent.get(event.eventId);
      if (lastSentAt !== undefined && now - lastSentAt < EVENT_RESEND_MS) return false;
      sent.set(event.eventId, now);
      return true;
    });
    return events;
  }

  private snapshotFor(playerId: string, forceFull: boolean): Record<string, unknown> {
    const input = this.ensureInputState(playerId);
    const tick = this.world?.tick ?? 0;
    const currentEntities = (this.world?.entities ?? [])
      .map((entity: any) => this.renderEntity(entity, playerId, true));
    const current = new Map<number, any>(currentEntities.map((entity: any) => [entity.id, entity]));
    const baselines = this.snapshotBaselines.get(playerId) ?? new Map<number, Map<number, any>>();
    this.snapshotBaselines.set(playerId, baselines);
    const baseTick = input.snapshotAck;
    const baseline = baseTick === null ? undefined : baselines.get(baseTick);
    const metadata = {
      roomIndex: this.world?.roomIndex ?? 0,
      roomCleared: Boolean(this.world?.roomCleared),
      doorCountdown: this.world?.doorCountdown ?? null,
      stageId: this.world?.stageId ?? null,
      difficulty: this.world?.difficulty ?? 'normal',
      openDoors: { ...(this.world?.openDoors ?? {}) },
      activeEnemyIds: [...(this.world?.roomEnemyIds ?? [])],
    };
    const metadataBaselines = this.snapshotMetadataBaselines.get(playerId)
      ?? new Map<number, Record<string, any>>();
    this.snapshotMetadataBaselines.set(playerId, metadataBaselines);
    const metadataBaseline = baseTick === null ? undefined : metadataBaselines.get(baseTick);
    const full = forceFull || tick % FULL_INTERVAL === 0 || !baseline || !metadataBaseline;
    let entities = currentEntities;
    const snapshot: Record<string, unknown> = {
      t: 'snap',
      tick,
      ack: input.lastAppliedSeq,
      full,
    };
    if (full) Object.assign(snapshot, metadata);
    else {
      snapshot.baseTick = baseTick;
      for (const [key, value] of Object.entries(metadata)) {
        if (JSON.stringify(metadataBaseline[key]) !== JSON.stringify(value)) snapshot[key] = value;
      }
    }
    const events = this.eventsForSnapshot(playerId);
    if (events.length) snapshot.ev = events;
    if (!full && baseline) {
      entities = [];
      for (const entity of currentEntities) {
        const previous = baseline.get(entity.id);
        if (!previous) {
          entities.push(entity);
          continue;
        }
        const changed: Record<string, unknown> = { id: entity.id };
        let hasChanges = false;
        for (const [key, value] of Object.entries(entity)) {
          if (key === 'id' || JSON.stringify(previous[key]) === JSON.stringify(value)) continue;
          changed[key] = value;
          hasChanges = true;
        }
        if (hasChanges) entities.push(changed);
      }
      const removed = [...baseline.keys()].filter((id) => !current.has(id));
      if (removed.length) snapshot.removed = removed;
    }
    snapshot.ents = entities;
    baselines.set(tick, current);
    metadataBaselines.set(tick, metadata);
    while (baselines.size > MAX_SNAPSHOT_BASELINES) {
      const oldestTick = Math.min(...baselines.keys());
      baselines.delete(oldestTick);
      metadataBaselines.delete(oldestTick);
    }
    return snapshot;
  }

  private sendSnapshot(socket: WebSocket, playerId: string, full: boolean): void {
    const input = this.ensureInputState(playerId);
    const forceFull = full || input.forceFullResync;
    const sent = this.send(socket, this.snapshotFor(playerId, forceFull));
    if (forceFull && sent) input.forceFullResync = false;
  }

  private broadcastSnapshots(full: boolean): void {
    if (!this.world) return;
    const seen = new Set<string>();
    for (const socket of this.connectedSockets()) {
      const playerId = socketPlayerId(socket);
      if (playerId && !seen.has(playerId) && this.world.players.some((id: number) => (
        this.world.entities.find((entity: any) => entity.id === id)?.playerId === playerId
      ))) {
        seen.add(playerId);
        this.sendSnapshot(socket, playerId, full);
      }
    }
    this.teleportPending = false;
  }

  private async finishRun(): Promise<void> {
    if (!this.world || this.finishingRun) return;
    this.finishingRun = true;
    this.clearLoop();
    this.broadcastSnapshots(true);
    const room = await this.readRoom();
    for (const socket of this.connectedSockets()) {
      const playerId = socketPlayerId(socket);
      const result = playerId ? this.world.results[playerId] : null;
      if (result) this.send(socket, { t: 'result', runId: this.runId, result });
    }
    this.lastDisconnectAt = null;
    try { await this.ctx.storage.deleteAlarm(); } catch {}
    await this.ctx.storage.delete('activeRunId');
    await this.writeRoom(room);
    await this.reportToCoord(room, 'update');
  }

  async alarm(): Promise<void> {
    if (this.connectedSockets().length > 0) return;
    if (this.world && !this.world.outcome) {
      completeStage(this.world, 'retreat');
      this.clearLoop();
      this.runId = null;
      this.lastDisconnectAt = null;
    }
  }
}
