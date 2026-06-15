// RoomDO — 방 1개 = 인스턴스 1개. Hibernatable WebSocket으로 소켓을 들고,
// 들어온 메시지를 직렬 처리해 seq 붙여 전원에게 broadcast.
//
// [배관 체크포인트 단계] 아직 게임 로직(applyAction) 없음.
//   - 지금: 메시지 = "이벤트"로 취급, seq 부여 후 전원 broadcast(직렬·순서보장 증명).
//   - 다음: webSocketMessage 안에서 gostop applyAction(state, action, user) 호출 →
//           newState 메모리 갱신 + events broadcast + 스냅샷. (seam은 이미 여기.)

interface Env {}

export class RoomDO {
  ctx: DurableObjectState;
  env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(req: Request): Promise<Response> {
    // 비-WS 요청: 헬스/상태
    if (req.headers.get('Upgrade') !== 'websocket') {
      const seq = (await this.ctx.storage.get<number>('seq')) ?? 0;
      return Response.json({
        ok: true,
        seq,
        connections: this.ctx.getWebSockets().length,
      });
    }

    const url = new URL(req.url);
    const user = (url.searchParams.get('u') || 'anon').slice(0, 40);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernation API: 메시지 없을 때 잠들어도 연결 유지(=idle 비용 0)
    this.ctx.acceptWebSocket(server, [user]);

    const seq = (await this.ctx.storage.get<number>('seq')) ?? 0;
    const connections = this.ctx.getWebSockets().length;
    server.send(JSON.stringify({ type: 'connected', user, seq, connections }));
    this.broadcast(
      JSON.stringify({ type: 'presence', event: 'join', user, connections }),
      server,
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  // 한 방의 모든 메시지는 이 DO 하나가 "한 번에 하나씩" 처리 → 동시 경합 없음(직렬화).
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const user = (this.ctx.getTags(ws)[0] as string) || 'anon';
    let data: unknown;
    try {
      data = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      data = { raw: String(message) };
    }

    let seq = (await this.ctx.storage.get<number>('seq')) ?? 0;
    seq += 1;
    await this.ctx.storage.put('seq', seq);

    // [seam] 여기서 나중에 gostop applyAction 호출로 교체.
    // 지금은 들어온 메시지를 그대로 이벤트화해 전원 broadcast(발신자 포함 → 정본 seq 수신).
    this.broadcast(JSON.stringify({ type: 'event', seq, from: user, payload: data }));
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const user = (this.ctx.getTags(ws)[0] as string) || 'anon';
    // 닫히는 소켓 제외한 현재 수
    const remaining = this.ctx.getWebSockets().filter((s) => s !== ws).length;
    this.broadcast(
      JSON.stringify({ type: 'presence', event: 'leave', user, connections: remaining }),
      ws,
    );
  }

  broadcast(msg: string, except?: WebSocket): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(msg);
      } catch {
        /* 끊긴 소켓 무시 */
      }
    }
  }
}
