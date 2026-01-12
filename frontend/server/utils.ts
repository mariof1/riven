import crypto from 'node:crypto';

export function generateSecret(): string {
        return crypto.randomBytes(32).toString('hex');
}

export function getRequestOrigin(req: import('http').IncomingMessage): string {
        const proto = (req.headers['x-forwarded-proto'] as string | undefined) || 'http';
        const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host || 'localhost:3000';
        return `${proto}://${host}`;
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
        if (!cookieHeader) return {};
        const out: Record<string, string> = {};
        for (const part of cookieHeader.split(';')) {
                const [rawKey, ...rest] = part.split('=');
                const key = rawKey?.trim();
                if (!key) continue;
                out[key] = decodeURIComponent(rest.join('=').trim());
        }
        return out;
}

export function appendSetCookie(res: import('http').ServerResponse, cookie: string) {
        const prev = res.getHeader('Set-Cookie');
        if (!prev) {
                res.setHeader('Set-Cookie', cookie);
                return;
        }
        if (Array.isArray(prev)) {
                res.setHeader('Set-Cookie', [...prev, cookie]);
                return;
        }
        res.setHeader('Set-Cookie', [String(prev), cookie]);
}
