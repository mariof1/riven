import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import { generatePlexPin, buildPlexAuthUrl, getDefaultPlexOptions } from "$lib/server/plex-oauth";
import { createScopedLogger } from "$lib/logger";

const logger = createScopedLogger("plex-authorize");

/**
 * Custom Plex authorization endpoint
 *
 * This intercepts Better Auth's OAuth2 flow and handles Plex's PIN-based authentication.
 * When Better Auth redirects here, we:
 * 1. Generate a Plex PIN
 * 2. Store the state and PIN info in a cookie
 * 3. Redirect to Plex's auth page
 *
 * After the user authorizes, Plex redirects to our callback which then
 * forwards to Better Auth's callback with the PIN as the "code".
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
    const state = url.searchParams.get("state");
    const redirectUri = url.searchParams.get("redirect_uri");

    if (!state) {
        redirect(302, "/auth/login?error=missing_state");
    }

    const options = getDefaultPlexOptions(env);

    const publicOrigin = env.ORIGIN || url.origin;
    const secureCookie = (() => {
        try {
            return new URL(publicOrigin).protocol === "https:";
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

        cookies.set("plex_auth_state", JSON.stringify(authData), {
            path: "/",
            httpOnly: true,
            // In container setups we often run over plain HTTP on LAN.
            // If `secure: true` on HTTP, browsers will drop the cookie and the callback can't find it.
            secure: secureCookie,
            sameSite: "lax",
            maxAge: 60 * 10 // 10 minutes
        });

        // Build the Plex auth URL with forwardUrl pointing to our callback
        const callbackUrl = `${publicOrigin}/api/plex/callback`;
        const plexAuthUrl = buildPlexAuthUrl(options, pin.code, callbackUrl);

        redirect(302, plexAuthUrl.toString());
    } catch (error) {
        // Re-throw redirect errors (they throw in SvelteKit, this is not necessarily an error, required for auth to work)
        if (error && typeof error === "object" && "status" in error && "location" in error) {
            throw error;
        }
        logger.error("Plex authorize error:", error);
        redirect(302, "/auth/login?error=plex_auth_failed");
    }
};
