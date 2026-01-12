import type { GenericOAuthConfig } from 'better-auth/plugins';

export interface PlexProfile {
        id: number;
        uuid: string;
        username: string;
        title: string;
        email: string;
        thumb: string;
        locale: string | null;
        emailOnlyAuth: boolean;
        hasPassword: boolean;
        protected: boolean;
        scrobbleTypes: string;
        country: string;
        subscription: {
                active: boolean;
                status: string;
                plan: string;
                features: string[];
        };
        subscriptionDescription: string;
        restricted: boolean;
        home: boolean;
        guest: boolean;
        homeSize: number;
        maxHomeSize: number;
        certificateVersion: number;
        rememberMe: boolean;
        pin: string;
        adsConsent: boolean | null;
        adsConsentSetAt: number | null;
        adsConsentReminderAt: number | null;
        experimentalFeatures: boolean;
        twoFactorEnabled: boolean;
        backupCodesCreated: boolean;
        services: Array<{
                identifier: string;
                endpoint: string;
                token: string;
                status: string;
                secret: string | null;
        }>;
}

export interface PlexOAuthOptions {
        clientId: string;
        product?: string;
        version?: string;
        platform?: string;
        device?: string;
        disableSignUp?: boolean;
}

interface PlexPinResponse {
        id: number;
        code: string;
        expiresAt: string;
        authToken: string | null;
        [key: string]: unknown;
}

function logError(...args: unknown[]) {
        // Keep this dependency-free since it runs in the dev server.
        // eslint-disable-next-line no-console
        console.error('[plex-oauth]', ...args);
}

export function getPlexHeaders(options: PlexOAuthOptions, includeToken?: string): Record<string, string> {
        const headers: Record<string, string> = {
                'X-Plex-Product': options.product || 'Riven Media',
                'X-Plex-Version': options.version || '1.0',
                'X-Plex-Client-Identifier': options.clientId,
                'X-Plex-Platform': options.platform || 'Web',
                'X-Plex-Device': options.device || 'Browser',
                'Content-Type': 'application/json',
                Accept: 'application/json'
        };
        if (includeToken) {
                headers['X-Plex-Token'] = includeToken;
        }
        return headers;
}

export async function generatePlexPin(options: PlexOAuthOptions): Promise<PlexPinResponse> {
        const response = await fetch('https://plex.tv/api/v2/pins', {
                method: 'POST',
                headers: getPlexHeaders(options),
                body: JSON.stringify({ strong: true })
        });

        if (!response.ok) {
                throw new Error('Failed to generate Plex PIN');
        }

        return response.json();
}

export function buildPlexAuthUrl(options: PlexOAuthOptions, pinCode: string, forwardUrl?: string): URL {
        const product = options.product || 'Riven Media';
        const version = options.version || '1.0';
        const platform = options.platform || 'Web';
        const device = options.device || 'Browser';

        const authURL = new URL('https://app.plex.tv/auth');
        authURL.hash = `?clientID=${encodeURIComponent(options.clientId)}&code=${encodeURIComponent(pinCode)}&context[device][product]=${encodeURIComponent(product)}&context[device][version]=${encodeURIComponent(version)}&context[device][platform]=${encodeURIComponent(platform)}&context[device][device]=${encodeURIComponent(device)}`;
        if (forwardUrl) {
                authURL.hash += `&forwardUrl=${encodeURIComponent(forwardUrl)}`;
        }

        return authURL;
}

export async function checkPlexPin(options: PlexOAuthOptions, pinId: string, pinCode: string): Promise<PlexPinResponse> {
        const response = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
                method: 'GET',
                headers: getPlexHeaders(options, pinCode)
        });

        if (!response.ok) {
                throw new Error('Failed to check PIN status');
        }

        return response.json();
}

export async function getPlexUserProfile(options: PlexOAuthOptions, authToken: string): Promise<PlexProfile> {
        const response = await fetch('https://plex.tv/api/v2/user', {
                method: 'GET',
                headers: getPlexHeaders(options, authToken)
        });

        if (!response.ok) {
                throw new Error(`Failed to fetch user info from Plex: ${response.status}`);
        }

        return response.json();
}

export function plexOAuth(options: PlexOAuthOptions & { baseURL?: string }): GenericOAuthConfig {
        if (!options.clientId) {
                throw new Error('Client ID is required for Plex OAuth provider');
        }

        const baseURL = options.baseURL || '';

        return {
                providerId: 'plex',
                clientId: options.clientId,
                clientSecret: 'not-used',
                authorizationUrl: `${baseURL}/api/plex/authorize`,
                tokenUrl: 'https://plex.tv/api/v2/pins',
                redirectURI: `${baseURL}/api/plex/callback`,
                scopes: [],
                disableSignUp: options.disableSignUp,
                getToken: async ({ code }) => {
                        const parts = code.split(':');
                        if (parts.length < 2) {
                                throw new Error('Invalid PIN code format, expected pinId:pinCode');
                        }

                        const pinId = parts[0];
                        const pinCode = parts[1];

                        const pinStatus = await checkPlexPin(options, pinId, pinCode);

                        if (!pinStatus.authToken) {
                                throw new Error('No auth token in PIN response - user may not have authorized');
                        }

                        return {
                                accessToken: pinStatus.authToken,
                                tokenType: 'Bearer',
                                accessTokenExpiresAt: undefined,
                                refreshToken: undefined,
                                scopes: [],
                                raw: pinStatus
                        };
                },
                getUserInfo: async (tokens) => {
                        if (!tokens.accessToken) {
                                return null;
                        }

                        try {
                                const profile = await getPlexUserProfile(options, tokens.accessToken);

                                return {
                                        id: profile.id.toString(),
                                        name: profile.title || profile.username,
                                        email: profile.email,
                                        image: profile.thumb,
                                        emailVerified: profile.emailOnlyAuth
                                };
                        } catch (error) {
                                logError('Failed to fetch user info from Plex:', error);
                                return null;
                        }
                }
        };
}

export function getDefaultPlexOptions(env: Record<string, string | undefined>): PlexOAuthOptions {
        return {
                clientId: env.PLEX_CLIENT_ID || 'riven',
                product: 'Riven Media',
                version: '1.0',
                platform: 'Web',
                device: 'Browser',
                disableSignUp: env.ENABLE_PLEX_SIGNUP !== 'true'
        };
}
