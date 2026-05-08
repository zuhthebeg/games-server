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

export async function migrateHostIfNeeded(env: Env, roomId: string, staleHostId?: string | null): Promise<string | null> {
    const room = await env.DB.prepare(
        'SELECT host_id, status FROM rooms WHERE id = ?'
    ).bind(roomId).first<{ host_id: string; status: string }>();

    if (!room || room.status !== 'playing') return null;
    if (staleHostId && room.host_id !== staleHostId) return null;

    const currentHost = await env.DB.prepare(
        'SELECT disconnected_at FROM room_players WHERE room_id = ? AND user_id = ?'
    ).bind(roomId, room.host_id).first<{ disconnected_at: string | null }>();

    if (currentHost && !currentHost.disconnected_at && !staleHostId) return null;

    const nextHost = await env.DB.prepare(
        `SELECT user_id FROM room_players
         WHERE room_id = ?
           AND user_id != ?
           AND disconnected_at IS NULL
         ORDER BY last_seen_at DESC, joined_at ASC
         LIMIT 1`
    ).bind(roomId, room.host_id).first<{ user_id: string }>();

    if (!nextHost?.user_id) return null;

    await env.DB.prepare(
        'UPDATE rooms SET host_id = ? WHERE id = ?'
    ).bind(nextHost.user_id, roomId).run();

    await addEvent(env, roomId, 'host_changed', nextHost.user_id, {
        previousHostId: room.host_id,
        reason: staleHostId ? 'presence_timeout' : 'host_disconnected',
        aiReplacement: true,
    });

    return nextHost.user_id;
}

export async function markStalePlayers(env: Env, roomId: string, now = Date.now()): Promise<number> {
    const staleCutoff = isoBefore(PRESENCE_STALE_MS, now);
    const { results } = await env.DB.prepare(
        `SELECT rp.*, r.host_id FROM room_players rp
         JOIN rooms r ON r.id = rp.room_id
         WHERE rp.room_id = ?
           AND r.status = 'playing'
           AND rp.disconnected_at IS NULL
           AND rp.last_seen_at IS NOT NULL
           AND rp.last_seen_at < ?
         ORDER BY rp.seat ASC`
    ).bind(roomId, staleCutoff).all<DBRoomPlayer & { host_id: string }>();

    const stalePlayers = results || [];
    if (stalePlayers.length === 0) return 0;

    const disconnectedAt = isoNow(now);
    let staleHostId: string | null = null;
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
        if (player.user_id === player.host_id) staleHostId = player.user_id;
    }

    if (staleHostId) {
        await migrateHostIfNeeded(env, roomId, staleHostId);
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
