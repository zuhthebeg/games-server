// Email service using Resend
// Free tier: 3000 emails/month

const MONTHLY_LIMIT = 3000;

interface EmailResult {
    success: boolean;
    error?: string;
}

export async function sendEmail(
    to: string,
    subject: string,
    html: string,
    env: { RESEND_API_KEY: string; DB: D1Database }
): Promise<EmailResult> {
    // Check monthly limit
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    
    const count = await env.DB.prepare(
        `SELECT COUNT(*) as count FROM email_log WHERE sent_at >= ?`
    ).bind(monthStart.toISOString()).first<{ count: number }>();
    
    if (count && count.count >= MONTHLY_LIMIT) {
        return { success: false, error: 'Monthly email limit reached' };
    }
    
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: 'COCY <noreply@cocy.io>',
                to: [to],
                subject,
                html
            })
        });
        
        if (!res.ok) {
            const error = await res.text();
            console.error('Resend error:', error);
            return { success: false, error: 'Failed to send email' };
        }
        
        // Log the email
        await env.DB.prepare(
            `INSERT INTO email_log (email, type) VALUES (?, ?)`
        ).bind(to, subject.includes('인증') ? 'verify' : 'reset').run();
        
        return { success: true };
    } catch (e) {
        console.error('Email error:', e);
        return { success: false, error: 'Email service error' };
    }
}

export function verifyEmailTemplate(nickname: string, verifyUrl: string): { subject: string; html: string } {
    return {
        subject: '[COCY] 이메일 인증',
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%); padding: 30px; border-radius: 12px; text-align: center; color: white;">
        <h1 style="margin: 0;">COCY</h1>
        <p style="margin: 10px 0 0;">게임 & 도구 플랫폼</p>
    </div>
    <div style="padding: 30px; background: #f8fafc; border-radius: 0 0 12px 12px;">
        <h2 style="color: #1e293b;">안녕하세요, ${nickname}님! 👋</h2>
        <p style="color: #64748b; line-height: 1.6;">
            COCY에 가입해주셔서 감사합니다.<br>
            아래 버튼을 클릭하여 이메일을 인증해주세요.
        </p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                이메일 인증하기
            </a>
        </div>
        <p style="color: #94a3b8; font-size: 14px;">
            이 링크는 24시간 동안 유효합니다.<br>
            본인이 가입하지 않으셨다면 이 메일을 무시해주세요.
        </p>
    </div>
</body>
</html>`
    };
}

export function resetPasswordTemplate(nickname: string, resetUrl: string): { subject: string; html: string } {
    return {
        subject: '[COCY] 비밀번호 재설정',
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%); padding: 30px; border-radius: 12px; text-align: center; color: white;">
        <h1 style="margin: 0;">COCY</h1>
        <p style="margin: 10px 0 0;">비밀번호 재설정</p>
    </div>
    <div style="padding: 30px; background: #f8fafc; border-radius: 0 0 12px 12px;">
        <h2 style="color: #1e293b;">${nickname}님</h2>
        <p style="color: #64748b; line-height: 1.6;">
            비밀번호 재설정 요청이 접수되었습니다.<br>
            아래 버튼을 클릭하여 새 비밀번호를 설정해주세요.
        </p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                비밀번호 재설정
            </a>
        </div>
        <p style="color: #94a3b8; font-size: 14px;">
            이 링크는 1시간 동안 유효합니다.<br>
            본인이 요청하지 않으셨다면 이 메일을 무시해주세요.
        </p>
    </div>
</body>
</html>`
    };
}
