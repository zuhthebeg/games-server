// Auth utilities for JWT, password hashing, etc.

// Simple password hashing using Web Crypto API
export async function hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
        'raw', data, 'PBKDF2', false, ['deriveBits']
    );
    const hash = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMaterial, 256
    );
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [saltHex, hashHex] = storedHash.split(':');
    if (!saltHex || !hashHex) return false;
    
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const keyMaterial = await crypto.subtle.importKey(
        'raw', data, 'PBKDF2', false, ['deriveBits']
    );
    const hash = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMaterial, 256
    );
    const computedHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    return computedHex === hashHex;
}

// JWT using Web Crypto API
export async function createJWT(payload: Record<string, any>, secret: string, expiresIn: number): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = { ...payload, iat: now, exp: now + expiresIn };
    
    const encoder = new TextEncoder();
    const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const payloadB64 = btoa(JSON.stringify(fullPayload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    
    const key = await crypto.subtle.importKey(
        'raw', encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = await crypto.subtle.sign(
        'HMAC', key, encoder.encode(`${headerB64}.${payloadB64}`)
    );
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    
    return `${headerB64}.${payloadB64}.${sigB64}`;
}

export async function verifyJWT(token: string, secret: string): Promise<Record<string, any> | null> {
    try {
        const [headerB64, payloadB64, sigB64] = token.split('.');
        if (!headerB64 || !payloadB64 || !sigB64) return null;
        
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw', encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
        );
        
        // Restore base64 padding
        const sig = Uint8Array.from(atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        const valid = await crypto.subtle.verify(
            'HMAC', key, sig, encoder.encode(`${headerB64}.${payloadB64}`)
        );
        if (!valid) return null;
        
        const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
        
        return payload;
    } catch {
        return null;
    }
}

// Token generation
export function generateToken(length: number = 32): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateId(): string {
    return generateToken(12); // 24 char hex
}

// Email validation
export function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Password validation (min 8 chars)
export function isValidPassword(password: string): boolean {
    return password.length >= 8;
}

// Extract bearer token from Authorization header
export function extractBearerToken(authHeader: string | null): string | null {
    if (!authHeader?.startsWith('Bearer ')) return null;
    return authHeader.slice(7);
}
