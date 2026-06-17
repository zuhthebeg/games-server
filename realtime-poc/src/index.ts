// relay-do-poc Worker entry — roomId로 RoomDO 라우팅 + 싱글톤 CoordinatorDO.
// /room/:id            (WebSocket Upgrade) → 그 방 DO로 전달
// /stats /rooms /match → CoordinatorDO(레지스트리: 어드민 메트릭/방목록/빠른매칭)
// 그 외                 → 상태/헬스
import { RoomDO } from './room-do';
import { CoordinatorDO } from './coordinator';

export { RoomDO, CoordinatorDO };

interface Env {
  ROOM: DurableObjectNamespace;
  COORD: DurableObjectNamespace;
}

const COORD_PATHS = new Set(['/stats', '/rooms', '/match']);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    const m = url.pathname.match(/^\/room\/([A-Za-z0-9_-]{1,64})$/);
    if (m) {
      const stub = env.ROOM.get(env.ROOM.idFromName(m[1]));
      return stub.fetch(req);
    }

    if (COORD_PATHS.has(url.pathname) || url.pathname.startsWith('/coord')) {
      const stub = env.COORD.get(env.COORD.idFromName('global'));
      return stub.fetch(req);
    }

    return new Response('relay-do-poc ok', { status: 200, headers: { 'content-type': 'text/plain' } });
  },
};
