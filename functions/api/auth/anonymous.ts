/**
 * POST /api/auth/anonymous
 * 익명 세션 생성
 */

import type { Env } from '../../types';
import { jsonResponse, errorResponse, generateId, createToken } from '../../types';

interface PagesContext {
    request: Request;
    env: Env;
}

// UA 기반 즉석 봇 판정. 여기서 못 잡는 정기 크롤러(headless가 아닌 척하는 것)는
// /api/admin/bot-reclassify의 버스트 패턴 분석이 잡는다.
const BOT_UA = /bot|crawl|spider|slurp|headless|python|curl|wget|scrapy|phantom|puppeteer|playwright|httpclient|axios|go-http/i;

export const onRequestPost = async (context: PagesContext): Promise<Response> => {
    const { env, request } = context;

    try {
        const userId = generateId();
        const now = new Date().toISOString();
        const ua = (request.headers.get('User-Agent') || '').slice(0, 300);
        const isBot = BOT_UA.test(ua);
        // 유입 게임 (클라가 ?game=poker 형태로 전달, shared-wallet/multiplayer가 pathname에서 추출)
        const gameRaw = new URL(request.url).searchParams.get('game') || '';
        const game = /^[a-z0-9_-]{1,32}$/i.test(gameRaw) ? gameRaw.toLowerCase() : null;

        await env.DB.prepare(
            `INSERT INTO users (id, is_anonymous, created_at, last_seen_at, signup_ua, bot_status, bot_reason, signup_game)
             VALUES (?, 1, ?, ?, ?, ?, ?, ?)`
        ).bind(
            userId, now, now, ua || null,
            isBot ? 'bot' : 'suspect',
            isBot ? 'UA 봇 시그니처' : '신규(무활동)',
            game
        ).run();

        // Generate token
        const token = createToken({ userId, isAnonymous: true });

        return jsonResponse({
            token,
            user: {
                id: userId,
                nickname: null,
                isAnonymous: true,
            },
        });
    } catch (error) {
        console.error('Anonymous auth error:', error);
        return errorResponse('Failed to create session', 500);
    }
};
