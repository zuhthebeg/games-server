/**
 * CORS Middleware for Cloudflare Pages Functions
 */

interface PagesContext {
    request: Request;
    env: any;
    next: () => Promise<Response>;
}

const ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:8788',
    'http://127.0.0.1:5500',
    'https://game.cocy.io',
    'https://games.cocy.io',
];

function getCorsHeaders(request: Request): Record<string, string> {
    const origin = request.headers.get('Origin') || '';
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
    };
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
    const { request, next } = context;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: getCorsHeaders(request),
        });
    }

    try {
        const response = await next();
        const newResponse = new Response(response.body, response);

        // Add CORS headers
        const corsHeaders = getCorsHeaders(request);
        Object.entries(corsHeaders).forEach(([key, value]) => {
            newResponse.headers.set(key, value);
        });

        return newResponse;
    } catch (error) {
        console.error('Middleware error:', error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) },
            }
        );
    }
};
