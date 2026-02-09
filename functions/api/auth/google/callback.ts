// GET /api/auth/google/callback - Google OAuth 콜백
import { createJWT, generateToken, generateId } from '../../../lib/auth';

interface Env {
    DB: D1Database;
    JWT_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    BASE_URL: string;
}

interface GoogleUserInfo {
    sub: string;      // Google ID
    email: string;
    email_verified: boolean;
    name: string;
    picture: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
    const { DB, JWT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BASE_URL } = context.env;
    const url = new URL(context.request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    
    // Frontend redirect helper
    const frontendUrl = BASE_URL || 'https://cocy.io';
    const redirectError = (msg: string) => 
        Response.redirect(`${frontendUrl}/login?error=${encodeURIComponent(msg)}`, 302);
    const redirectSuccess = (token: string) =>
        Response.redirect(`${frontendUrl}/oauth-callback?token=${token}`, 302);
    
    if (error) {
        return redirectError('Google 로그인이 취소되었습니다');
    }
    
    if (!code) {
        return redirectError('인증 코드가 없습니다');
    }
    
    // Validate state (CSRF)
    const cookies = context.request.headers.get('Cookie') || '';
    const stateCookie = cookies.match(/oauth_state=([^;]+)/)?.[1];
    if (!stateCookie || stateCookie !== state) {
        return redirectError('잘못된 요청입니다');
    }
    
    try {
        // Exchange code for tokens
        const redirectUri = `${BASE_URL || 'https://relay.cocy.io'}/api/auth/google/callback`;
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            })
        });
        
        if (!tokenRes.ok) {
            console.error('Token exchange failed:', await tokenRes.text());
            return redirectError('Google 인증에 실패했습니다');
        }
        
        const tokens = await tokenRes.json() as { access_token: string };
        
        // Get user info
        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { 'Authorization': `Bearer ${tokens.access_token}` }
        });
        
        if (!userRes.ok) {
            return redirectError('사용자 정보를 가져오지 못했습니다');
        }
        
        const googleUser = await userRes.json() as GoogleUserInfo;
        
        // Find or create user
        let user = await DB.prepare(`
            SELECT id, email, nickname, email_verified, avatar_url
            FROM users WHERE google_id = ?
        `).bind(googleUser.sub).first<{
            id: string;
            email: string;
            nickname: string;
            email_verified: number;
            avatar_url: string | null;
        }>();
        
        if (!user) {
            // Check if email already exists
            const existingEmail = await DB.prepare(`
                SELECT id FROM users WHERE email = ?
            `).bind(googleUser.email.toLowerCase()).first<{ id: string }>();
            
            if (existingEmail) {
                // Link Google to existing account
                await DB.prepare(`
                    UPDATE users SET google_id = ?, email_verified = 1, updated_at = datetime('now')
                    WHERE id = ?
                `).bind(googleUser.sub, existingEmail.id).run();
                
                user = await DB.prepare(`
                    SELECT id, email, nickname, email_verified, avatar_url FROM users WHERE id = ?
                `).bind(existingEmail.id).first();
            } else {
                // Create new user
                const userId = generateId();
                const nickname = googleUser.name || googleUser.email.split('@')[0];
                
                await DB.prepare(`
                    INSERT INTO users (id, email, google_id, nickname, avatar_url, is_anonymous, email_verified, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 0, 1, datetime('now'), datetime('now'))
                `).bind(userId, googleUser.email.toLowerCase(), googleUser.sub, nickname, googleUser.picture).run();
                
                user = { id: userId, email: googleUser.email, nickname, email_verified: 1, avatar_url: googleUser.picture };
            }
        }
        
        if (!user) {
            return redirectError('사용자 생성에 실패했습니다');
        }
        
        // Update last login
        await DB.prepare(`
            UPDATE users SET last_seen_at = datetime('now') WHERE id = ?
        `).bind(user.id).run();
        
        // Create tokens
        const accessToken = await createJWT({
            sub: user.id,
            email: user.email,
            nickname: user.nickname,
            emailVerified: true
        }, JWT_SECRET, 900);
        
        const refreshToken = generateToken(48);
        const refreshExpires = Math.floor(Date.now() / 1000) + 2592000;
        
        await DB.prepare(`
            INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)
        `).bind(refreshToken, user.id, refreshExpires).run();
        
        // Return tokens via redirect with cookie
        const response = new Response(null, {
            status: 302,
            headers: {
                'Location': `${frontendUrl}/oauth-callback?success=true`,
                'Set-Cookie': [
                    `access_token=${accessToken}; HttpOnly; Secure; SameSite=Lax; Max-Age=900; Path=/`,
                    `refresh_token=${refreshToken}; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000; Path=/`
                ].join(', ')
            }
        });
        
        return response;
        
    } catch (e) {
        console.error('Google callback error:', e);
        return redirectError('서버 오류가 발생했습니다');
    }
};
