// relay-do-poc Worker entry — roomId로 RoomDO 라우팅.
// /room/:id  (WebSocket Upgrade) → 그 방 DO로 전달
// 그 외       → 상태/헬스
import { RoomDO } from './room-do';

export { RoomDO };

interface Env {
  ROOM: DurableObjectNamespace;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9_-]{1,64})$/);
    if (!m) {
      return new Response('relay-do-poc ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    const roomId = m[1];
    const id = env.ROOM.idFromName(roomId);
    const stub = env.ROOM.get(id);
    return stub.fetch(req);
  },
};
