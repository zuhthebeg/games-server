// Global middleware for CORS
export const onRequest: PagesFunction = async (context) => {
    // Handle preflight
    if (context.request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
                'Access-Control-Max-Age': '86400',
            }
        });
    }

    // Process request
    const response = await context.next();
    
    // Clone and add CORS headers
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Secret');
    
    // 인증 필요한 엔드포인트 캐시 방지 (CDN 캐시로 인한 401 재전송 방지)
    const url = new URL(context.request.url);
    if (url.pathname.startsWith('/api/user/') || url.pathname.startsWith('/api/auth/')) {
        newResponse.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        newResponse.headers.set('Pragma', 'no-cache');
    }
    
    return newResponse;
};
