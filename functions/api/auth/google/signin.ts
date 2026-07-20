// POST /api/auth/google/signin — Google One Tap / GSI credential → JWT
import { createJWT, generateId } from '../../../lib/auth';

interface Env { DB: D1Database; JWT_SECRET: string; GOOGLE_CLIENT_ID: string; }

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { credential } = await request.json() as { credential: string };
    if (!credential) return Response.json({ error: 'credential required' }, { status: 400, headers: CORS });

    // Verify Google ID token
    const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + credential);
    if (!res.ok) return Response.json({ error: 'Invalid credential' }, { status: 401, headers: CORS });

    const info = await res.json() as any;
    if (info.aud !== env.GOOGLE_CLIENT_ID) return Response.json({ error: 'Client ID mismatch' }, { status: 401, headers: CORS });

    const googleId = info.sub;
    const email = info.email;
    const name = info.name || email.split('@')[0];
    const picture = info.picture || null;

    // Find or create user
    let user = await env.DB.prepare('SELECT id, nickname FROM users WHERE google_id = ?').bind(googleId).first() as any;
    if (!user) {
      user = await env.DB.prepare('SELECT id, nickname FROM users WHERE email = ?').bind(email).first() as any;
      if (user) {
        await env.DB.prepare('UPDATE users SET google_id = ?, avatar_url = ?, is_anonymous = 0 WHERE id = ?').bind(googleId, picture, user.id).run();
      } else {
        const id = generateId();
        await env.DB.prepare(
          "INSERT INTO users (id, email, nickname, email_verified, google_id, avatar_url, is_anonymous, created_at) VALUES (?, ?, ?, 1, ?, ?, 0, datetime('now'))"
        ).bind(id, email, name, googleId, picture).run();
        user = { id, nickname: name };
      }
    }
    // 과거 가입분 self-heal: 구글 인증된 계정은 등록계정이다 (is_anonymous=1로 남으면 랭킹 제출이 403)
    await env.DB.prepare('UPDATE users SET is_anonymous = 0 WHERE id = ? AND is_anonymous = 1').bind(user.id).run();

    const token = await createJWT({ sub: user.id, email }, env.JWT_SECRET, 30 * 24 * 3600);
    return Response.json({ token, user: { id: user.id, nickname: user.nickname, email } }, { headers: CORS });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500, headers: CORS });
  }
};
