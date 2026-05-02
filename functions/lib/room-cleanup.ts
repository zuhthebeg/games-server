import type { Env } from '../types';

export interface RoomCleanupResult {
    deleted: number;
    roomIds: string[];
}

const WAITING_EMPTY_MAX_MS = 5 * 60 * 1000;
const WAITING_SOLO_MAX_MS = 30 * 60 * 1000;
const WAITING_ANY_MAX_MS = 6 * 60 * 60 * 1000;
const PLAYING_SOLO_MAX_MS = 6 * 60 * 60 * 1000;
const FINISHED_MAX_MS = 24 * 60 * 60 * 1000;

function isoBefore(msAgo: number, now = Date.now()): string {
    return new Date(now - msAgo).toISOString();
}

function placeholders(count: number): string {
    return Array(count).fill('?').join(',');
}

export async function cleanupStaleRooms(env: Env, now = Date.now()): Promise<RoomCleanupResult> {
    const waitingEmptyCutoff = isoBefore(WAITING_EMPTY_MAX_MS, now);
    const waitingSoloCutoff = isoBefore(WAITING_SOLO_MAX_MS, now);
    const waitingAnyCutoff = isoBefore(WAITING_ANY_MAX_MS, now);
    const playingSoloCutoff = isoBefore(PLAYING_SOLO_MAX_MS, now);
    const finishedCutoff = isoBefore(FINISHED_MAX_MS, now);

    const { results } = await env.DB.prepare(`
        SELECT r.id, COUNT(rp.user_id) AS player_count
        FROM rooms r
        LEFT JOIN room_players rp ON rp.room_id = r.id
        GROUP BY r.id
        HAVING
            (r.status = 'waiting' AND player_count = 0 AND r.created_at < ?)
            OR (r.status = 'waiting' AND player_count <= 1 AND r.created_at < ?)
            OR (r.status = 'waiting' AND r.created_at < ?)
            OR (r.status = 'playing' AND player_count <= 1 AND COALESCE(r.started_at, r.created_at) < ?)
            OR (r.status = 'finished' AND COALESCE(r.finished_at, r.created_at) < ?)
        ORDER BY r.created_at ASC
        LIMIT 100
    `).bind(
        waitingEmptyCutoff,
        waitingSoloCutoff,
        waitingAnyCutoff,
        playingSoloCutoff,
        finishedCutoff
    ).all<{ id: string; player_count: number }>();

    const roomIds = (results || []).map(r => r.id).filter(Boolean);
    if (roomIds.length === 0) return { deleted: 0, roomIds: [] };

    const inClause = placeholders(roomIds.length);
    await env.DB.batch([
        env.DB.prepare(`DELETE FROM events WHERE room_id IN (${inClause})`).bind(...roomIds),
        env.DB.prepare(`DELETE FROM room_players WHERE room_id IN (${inClause})`).bind(...roomIds),
        env.DB.prepare(`DELETE FROM rooms WHERE id IN (${inClause})`).bind(...roomIds),
    ]);

    return { deleted: roomIds.length, roomIds };
}
