// GET /api/auth/google - Google OAuth 시작
interface Env {
    GOOGLE_CLIENT_ID: string;
    BASE_URL: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
    const { GOOGLE_CLIENT_ID, BASE_URL } = context.env;
    
    if (!GOOGLE_CLIENT_ID) {
        return Response.json({ error: 'Google OAuth가 설정되지 않았습니다' }, { status: 500 });
    }
    
    const redirectUri = `${BASE_URL || 'https://relay.cocy.io'}/api/auth/google/callback`;
    const state = crypto.randomUUID(); // CSRF protection
    
    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'offline',
        prompt: 'select_account'
    });
    
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    
    // Set state cookie for CSRF validation
    return new Response(null, {
        status: 302,
        headers: {
            'Location': authUrl,
            'Set-Cookie': `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`
        }
    });
};
