import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { auth, getAuthProviders } from './server/auth';
import { buildPlexAuthUrl, checkPlexPin, generatePlexPin, getDefaultPlexOptions } from './server/plex-oauth';
import { appendSetCookie, getRequestOrigin, parseCookies } from './server/utils';
import { getUsersCount } from './server/functions';

async function handleFetchResponse(res: ServerResponse, response: Response) {
        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
                // ServerResponse#setHeader supports string|string[]
                if (key.toLowerCase() === 'set-cookie') {
                        appendSetCookie(res, value);
                        return;
                }
                res.setHeader(key, value);
        });

        const body = Buffer.from(await response.arrayBuffer());
        res.end(body);
}

async function toRequest(req: IncomingMessage): Promise<Request> {
        const origin = getRequestOrigin(req);
        const url = new URL(req.url || '/', origin);

        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
                if (v === undefined) continue;
                headers.set(k, Array.isArray(v) ? v.join(',') : v);
        }

        const method = (req.method || 'GET').toUpperCase();
        const hasBody = !['GET', 'HEAD'].includes(method);

        return new Request(url, {
                method,
                headers,
                // Node's fetch Request requires duplex when streaming request bodies.
                body: hasBody ? (req as unknown as BodyInit) : undefined,
                // @ts-expect-error - Node-only option for streaming bodies
                duplex: hasBody ? 'half' : undefined
        });
}

function redirect(res: ServerResponse, location: string) {
        res.statusCode = 302;
        res.setHeader('Location', location);
        res.end();
}

export function authMiddlewarePlugin(): Plugin {
        return {
                name: 'riven-auth-middleware',
                configureServer(server) {
                        server.middlewares.use(async (req, res, next) => {
                                if (!req.url) return next();

                                const origin = getRequestOrigin(req);
                                const url = new URL(req.url, origin);

                                // Custom helper endpoint for the React login page.
                                if (url.pathname === '/api/auth/providers' && req.method === 'GET') {
                                        const providers = getAuthProviders();
                                        const usersCount = await getUsersCount();
                                        res.statusCode = 200;
                                        res.setHeader('Content-Type', 'application/json');
                                        res.end(JSON.stringify({ providers, isFirstUser: usersCount === 0 }));
                                        return;
                                }

                                // Plex OAuth helper endpoints (used by the Plex Generic OAuth provider).
                                if (url.pathname === '/api/plex/authorize' && req.method === 'GET') {
                                        const state = url.searchParams.get('state');
                                        const redirectUri = url.searchParams.get('redirect_uri');
                                        if (!state) {
                                                redirect(res, '/auth/login?error=missing_state');
                                                return;
                                        }

                                        const options = getDefaultPlexOptions(process.env as Record<string, string | undefined>);

                                        const publicOrigin = process.env.ORIGIN || origin;
                                        const secureCookie = (() => {
                                                try {
                                                        return new URL(publicOrigin).protocol === 'https:';
                                                } catch {
                                                        return false;
                                                }
                                        })();

                                        try {
                                                const pin = await generatePlexPin(options);
                                                const authData = {
                                                        state,
                                                        redirectUri,
                                                        pinId: pin.id,
                                                        pinCode: pin.code,
                                                        expiresAt: pin.expiresAt
                                                };

                                                const cookie = [
                                                        `plex_auth_state=${encodeURIComponent(JSON.stringify(authData))}`,
                                                        'Path=/',
                                                        'HttpOnly',
                                                        'SameSite=Lax',
                                                        `Max-Age=${60 * 10}`,
                                                        ...(secureCookie ? ['Secure'] : [])
                                                ].join('; ');
                                                appendSetCookie(res, cookie);

                                                const callbackUrl = `${publicOrigin}/api/plex/callback`;
                                                const plexAuthUrl = buildPlexAuthUrl(options, pin.code, callbackUrl);
                                                redirect(res, plexAuthUrl.toString());
                                        } catch (error) {
                                                // eslint-disable-next-line no-console
                                                console.error('[plex-authorize] error:', error);
                                                redirect(res, '/auth/login?error=plex_auth_failed');
                                        }
                                        return;
                                }

                                if (url.pathname === '/api/plex/callback' && req.method === 'GET') {
                                        const cookies = parseCookies(req.headers.cookie);
                                        const storedDataStr = cookies.plex_auth_state;
                                        if (!storedDataStr) {
                                                // eslint-disable-next-line no-console
                                                console.error('[plex-callback] No auth state cookie found');
                                                redirect(res, '/auth/login?error=state_not_found');
                                                return;
                                        }

                                        let storedData: {
                                                state: string;
                                                redirectUri: string | null;
                                                pinId: number;
                                                pinCode: string;
                                                expiresAt: string;
                                        };

                                        try {
                                                storedData = JSON.parse(storedDataStr);
                                        } catch {
                                                // eslint-disable-next-line no-console
                                                console.error('[plex-callback] Failed to parse auth state cookie');
                                                redirect(res, '/auth/login?error=invalid_state');
                                                return;
                                        } finally {
                                                appendSetCookie(res, 'plex_auth_state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
                                        }

                                        const options = getDefaultPlexOptions(process.env as Record<string, string | undefined>);

                                        try {
                                                const pinStatus = await checkPlexPin(options, storedData.pinId.toString(), storedData.pinCode);
                                                if (!pinStatus.authToken) {
                                                        // eslint-disable-next-line no-console
                                                        console.error('[plex-callback] PIN not authorized yet');
                                                        redirect(res, '/auth/login?error=not_authorized');
                                                        return;
                                                }

                                                const base = process.env.ORIGIN || origin;
                                                const oauthCallbackUrl = new URL('/api/auth/oauth2/callback/plex', base);
                                                oauthCallbackUrl.searchParams.set('code', `${storedData.pinId}:${storedData.pinCode}`);
                                                oauthCallbackUrl.searchParams.set('state', storedData.state);

                                                redirect(res, oauthCallbackUrl.toString());
                                        } catch (error) {
                                                // eslint-disable-next-line no-console
                                                console.error('[plex-callback] error:', error);
                                                redirect(res, '/auth/login?error=callback_failed');
                                        }
                                        return;
                                }

                                // Better Auth endpoints.
                                if (url.pathname.startsWith('/api/auth')) {
                                        try {
                                                const request = await toRequest(req);
                                                const response = await auth.handler(request);
                                                await handleFetchResponse(res, response);
                                        } catch (error) {
                                                // eslint-disable-next-line no-console
                                                console.error('[auth] handler error:', error);
                                                res.statusCode = 500;
                                                res.setHeader('Content-Type', 'application/json');
                                                res.end(JSON.stringify({ error: 'auth_handler_failed' }));
                                        }
                                        return;
                                }

                                next();
                        });
                }
        };
}
