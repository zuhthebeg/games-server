/**
 * GET /api/rooms/:id/stream - SSE 실시간 스트림
 * Query params: token (JWT)
 */

import type { Env, DBEvent } from '../../../types';
import { errorResponse, parseToken } from '../../../types';

interface PagesContext {
    request: Request;
    env: Env;
    params: { id: string };
}

function sseFormat(event: string, data: any): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
    const { request, env, params } = context;
    const roomId = params.id;

    // Get token from query (SSE can't send headers)
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token) {
        return errorResponse('Token required', 401);
    }

    const tokenData = parseToken(decodeURIComponent(token));
    if (!tokenData) {
        return errorResponse('Invalid token', 401);
    }

    // Verify room exists
    const room = await env.DB.prepare('SELECT id FROM rooms WHERE id = ?').bind(roomId).first();
    if (!room) {
        return errorResponse('Room not found', 404);
    }

    // Create SSE stream
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Send connection event
    await writer.write(encoder.encode(sseFormat('connected', { roomId, userId: tokenData.userId })));

    // Keep-alive ping every 30s
    const keepAlive = setInterval(async () => {
        try {
            await writer.write(encoder.encode(': ping\n\n'));
        } catch {
            clearInterval(keepAlive);
        }
    }, 30000);

    // Poll for events
    let lastSeq = 0;
    const pollInterval = setInterval(async () => {
        try {
            const { results: events } = await env.DB.prepare(
                'SELECT * FROM events WHERE room_id = ? AND seq > ? ORDER BY seq ASC LIMIT 50'
            ).bind(roomId, lastSeq).all<DBEvent>();

            if (events && events.length > 0) {
                for (const event of events) {
                    await writer.write(encoder.encode(sseFormat(event.event_type, {
                        seq: event.seq,
                        userId: event.user_id,
                        payload: event.payload ? JSON.parse(event.payload) : null,
                        createdAt: event.created_at,
                    })));
                    lastSeq = event.seq;
                }
            }
        } catch (error) {
            console.error('SSE poll error:', error);
        }
    }, 1000); // Poll every second

    // Cleanup on disconnect
    request.signal.addEventListener('abort', () => {
        clearInterval(keepAlive);
        clearInterval(pollInterval);
        writer.close();
    });

    return new Response(readable, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        },
    });
};
