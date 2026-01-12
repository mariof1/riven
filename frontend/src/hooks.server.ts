import { auth } from "$lib/server/auth";
import { redirect, error, type Handle, type HandleFetch, type ServerInit } from "@sveltejs/kit";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { building } from "$app/environment";
import { sequence } from "@sveltejs/kit/hooks";
import { env } from "$env/dynamic/private";
import providers from "$lib/providers";
import { dev } from "$app/environment";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "$lib/server/db";
import { createCustomFetch } from "$lib/custom-fetch";
import { createScopedLogger } from "$lib/logger";

const logger = createScopedLogger("hooks");
const fetchLogger = createScopedLogger("fetch");

function shouldSkipTimeout(request: Request): boolean {
    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("text/event-stream")) return true;

    // Streaming endpoints (HLS/SSE) can legitimately run indefinitely.
    const pathname = new URL(request.url).pathname;
    return (
        pathname.includes("/stream/") ||
        pathname.includes("/scrape_stream") ||
        pathname.includes("/notifications")
    );
}

function withTimeoutSignal(request: Request, timeoutMs: number): Request {
    if (timeoutMs <= 0 || shouldSkipTimeout(request)) {
        return request;
    }

    // Node.js 18+ supports AbortSignal.timeout and AbortSignal.any.
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const existingSignal = request.signal;

    // If the request already has a signal, combine it.
    const combinedSignal = existingSignal ? AbortSignal.any([existingSignal, timeoutSignal]) : timeoutSignal;
    return new Request(request, { signal: combinedSignal });
}

export const handleFetch: HandleFetch = async ({ event, request, fetch }) => {
    const start = Date.now();
    const backendBase = event.locals.backendUrl;

    // Prefer a shorter timeout for external providers; keep backend slightly longer.
    const isBackendCall = !!backendBase && request.url.startsWith(backendBase);
    const timeoutMs = isBackendCall ? 30_000 : 20_000;

    try {
        const req = withTimeoutSignal(request, timeoutMs);
        const response = await fetch(req);

        const elapsedMs = Date.now() - start;
        if (elapsedMs >= 2_000) {
            fetchLogger.warn(
                `${request.method} ${new URL(request.url).pathname} -> ${response.status} in ${elapsedMs}ms` +
                    (isBackendCall ? " (backend)" : "")
            );
        }

        return response;
    } catch (e) {
        const elapsedMs = Date.now() - start;
        const msg = e instanceof Error ? e.message : String(e);
        fetchLogger.error(
            `${request.method} ${new URL(request.url).pathname} failed after ${elapsedMs}ms` +
                (isBackendCall ? " (backend)" : "") +
                `: ${msg}`
        );
        throw e;
    }
};

export const init: ServerInit = async () => {
    if (!env.BACKEND_URL) {
        throw new Error("BACKEND_URL environment variable is required");
    }
    if (!env.BACKEND_API_KEY) {
        throw new Error("BACKEND_API_KEY environment variable is required");
    }
    migrate(db, { migrationsFolder: "drizzle" });

    // @ts-expect-error ignore
    logger.box(`Riven Frontend v${__APP_VERSION__}`);
};

export const betterAuthHandler: Handle = async ({ event, resolve }) => {
    if (event.route.id?.startsWith("/(protected)")) {
        const session = await auth.api.getSession({
            headers: event.request.headers
        });

        if (session) {
            event.locals.session = session?.session;
            event.locals.user = session?.user;
            return svelteKitHandler({ event, resolve, auth, building });
        } else {
            throw redirect(307, "/auth/login");
        }
    } else {
        return svelteKitHandler({ event, resolve, auth, building });
    }
};

const configureLocals: Handle = async ({ event, resolve }) => {
    event.locals.backendUrl = env.BACKEND_URL;
    event.locals.apiKey = env.BACKEND_API_KEY;

    return resolve(event);
};

const handleTVDBCookie: Handle = async ({ event, resolve }) => {
    const tvdbCookie = event.cookies.get("tvdb_cookie");

    if (!tvdbCookie) {
        const customFetch = createCustomFetch(event.fetch);
        const tvdbLogin = await providers.tvdb.POST("/login", {
            body: {
                apikey: "6be85335-5c4f-4d8d-b945-d3ed0eb8cdce"
            },
            fetch: customFetch
        });

        if (tvdbLogin.error) {
            error(500, "Failed to login to TVDB: " + tvdbLogin.error);
        } else {
            event.cookies.set("tvdb_cookie", tvdbLogin.data?.data?.token || "", {
                path: "/",
                httpOnly: true,
                sameSite: "lax",
                secure: !dev,
                maxAge: 60 * 60 * 24 * 30 // 30 days
            });
            logger.info("Set TVDB cookie");
        }
    }

    return resolve(event);
};

export const handle: Handle = sequence(
    configureLocals,
    betterAuthHandler,
    handleTVDBCookie
);
