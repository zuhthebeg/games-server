/**
 * Cloudflare Environment Types
 */

export interface Env {
    DB: D1Database;
    ENVIRONMENT: string;
}

// ============================================
// Database Types
// ============================================

export interface DBUser {
    id: string;
    nickname: string | null;
    is_anonymous: number;
    created_at: string;
    last_seen_at: string | null;
}

export interface DBRoom {
    id: string;
    game_type: string;
    status: 'waiting' | 'playing' | 'finished';
    host_id: string;
    config: string | null;
    state: string | null;
    max_players: number;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
}

export interface DBRoomPlayer {
    room_id: string;
    user_id: string;
    seat: number | null;
    is_ready: number;
    player_state: string | null;
    joined_at: string;
}

export interface DBEvent {
    id: number;
    room_id: string;
    seq: number;
    event_type: string;
    user_id: string | null;
    payload: string | null;
    created_at: string;
}

// ============================================
// API Response Helpers
// ============================================

export function jsonResponse(data: any, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export function errorResponse(message: string, status = 400): Response {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// ============================================
// Auth Helpers
// ============================================

export interface TokenPayload {
    userId: string;
    isAnonymous: boolean;
    exp: number;
}

/**
 * 간단한 JWT 생성 (서명 없음 - 데모용)
 * 프로덕션에서는 서명 추가 권장
 */
export function createToken(payload: Omit<TokenPayload, 'exp'>, expiresInHours = 24): string {
    const exp = Date.now() + expiresInHours * 60 * 60 * 1000;
    const tokenPayload: TokenPayload = { ...payload, exp };
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const body = btoa(JSON.stringify(tokenPayload));
    return `${header}.${body}.`;
}

/**
 * 토큰 파싱
 */
export function parseToken(token: string): TokenPayload | null {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = JSON.parse(atob(parts[1])) as TokenPayload;
        if (payload.exp < Date.now()) return null;
        return payload;
    } catch {
        return null;
    }
}

/**
 * Request에서 사용자 추출
 */
export function getUserFromRequest(request: Request): TokenPayload | null {
    const auth = request.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return null;
    return parseToken(auth.slice(7));
}

// ============================================
// Utility
// ============================================

/**
 * 6자리 방 코드 생성
 */
export function generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 혼동 문자 제외
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

/**
 * UUID 생성
 */
export function generateId(): string {
    return crypto.randomUUID();
}
