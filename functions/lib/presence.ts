import type { Env, DBRoomPlayer } from '../types';

export const PRESENCE_PING_MS = 5000;
export const PRESENCE_STALE_MS = 25000;

function isoNow(now = Date.now()): string {
    return new Date(now).toISOString();
}

function isoBefore(msAgo: number, now = Date.now()): string {
    return new Date(now - msAgo).toISOString();
}

export async function touchPlayerPresence(env: Env, roomId: string, userId: string, now = Date.now()): Promise<{ rejoined: boolean; seat: number | null }> {
    const player = await env.DB.prepare(
        'SELECT * FROM room_players WHERE room_id = ? AND user_id = ?'
    ).bind(roomId, userId).first<DBRoomPlayer & { disconnected_at?: string | null }>();

    if (!player) return { rejoined: false, seat: null };

    const rejoined = !!player.disconnected_at;
    await env.DB.prepare(
        'UPDATE room_players SET last_seen_at = ?, disconnected_at = NULL WHERE room_id = ? AND user_id = ?'
    ).bind(isoNow(now), roomId, userId).run();

    if (rejoined) {
        await addEvent(env, roomId, 'player_joined', userId, { seat: player.seat, rejoined: true, presence: true });
    }

    return { rejoined, seat: player.seat };
}

export async function markStalePlayers(env: Env, roomId: string, now = Date.now()): Promise<number> {
    const staleCutoff = isoBefore(PRESENCE_STALE_MS, now);
    const { results } = await env.DB.prepare(
        `SELECT rp.* FROM room_players rp
         JOIN rooms r ON r.id = rp.room_id
         WHERE rp.room_id = ?
           AND r.status = 'playing'
           AND rp.disconnected_at IS NULL
           AND rp.last_seen_at IS NOT NULL
           AND rp.last_seen_at < ?
         ORDER BY rp.seat ASC`
    ).bind(roomId, staleCutoff).all<DBRoomPlayer>();

    const stalePlayers = results || [];
    if (stalePlayers.length === 0) return 0;

    const disconnectedAt = isoNow(now);
    for (const player of stalePlayers) {
        await env.DB.prepare(
            'UPDATE room_players SET disconnected_at = ? WHERE room_id = ? AND user_id = ? AND disconnected_at IS NULL'
        ).bind(disconnectedAt, roomId, player.user_id).run();
        await addEvent(env, roomId, 'player_left', player.user_id, {
            seat: player.seat,
            aiReplacement: true,
            reason: 'presence_timeout',
            lastSeenAt: (player as any).last_seen_at,
        });
    }

    return stalePlayers.length;
}

async function addEvent(env: Env, roomId: string, type: string, userId: string | null, payload: any) {
    const { results } = await env.DB.prepare(
        'SELECT MAX(seq) as maxSeq FROM events WHERE room_id = ?'
    ).bind(roomId).all<{ maxSeq: number | null }>();

    const seq = (results?.[0]?.maxSeq || 0) + 1;

    await env.DB.prepare(
        'INSERT INTO events (room_id, seq, event_type, user_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(roomId, seq, type, userId, JSON.stringify(payload), isoNow()).run();
}
