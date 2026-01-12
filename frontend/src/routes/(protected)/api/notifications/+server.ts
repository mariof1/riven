import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import { produce } from "sveltekit-sse";
import { createScopedLogger } from "$lib/logger";

const logger = createScopedLogger("notifications-api");

export const POST: RequestHandler = async ({ locals, fetch }) => {
    if (!locals.user || !locals.session) {
        error(401, "Unauthorized");
    }

    const backendUrl = env.BACKEND_URL;
    if (!backendUrl) {
        logger.error("Notification proxy: BACKEND_URL is not configured");
        error(500, "Backend URL is not configured");
    }

    return produce(async function start({ emit, lock }) {
        const abortController = new AbortController();

        try {
            const response = await fetch(`${backendUrl}/api/v1/stream/notifications`, {
                method: "GET",
                headers: {
                    "x-api-key": env.BACKEND_API_KEY || "",
                    Accept: "text/event-stream",
                    "Cache-Control": "no-cache"
                },
                signal: abortController.signal
            });

            if (!response.ok) {
                logger.error(`Notification proxy: Backend error ${response.status}`);
                lock.set(false);
                return function stop() {
                    abortController.abort();
                };
            }

            const reader = response.body?.getReader();
            if (!reader) {
                logger.error("Notification proxy: No response body");
                lock.set(false);
                return function stop() {
                    abortController.abort();
                };
            }

            const decoder = new TextDecoder();
            let buffer = "";

            // SSE events may contain multiple `data:` lines; an empty line terminates an event.
            // We re-emit only complete events to avoid sending partial JSON chunks to the client.
            let dataLines: string[] = [];
            let eventType: string | null = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || "";

                for (const line of lines) {
                    // Blank line = end of event
                    if (line === "") {
                        if (dataLines.length > 0) {
                            const data = dataLines.join("\n");
                            dataLines = [];

                            const shouldEmit = eventType === null || eventType === "notification";
                            eventType = null;

                            if (!shouldEmit) {
                                continue;
                            }

                            // Ignore empty payloads (common keepalive pattern)
                            if (data.trim().length === 0) {
                                continue;
                            }

                            const { error: emitError } = emit("notification", data);
                            if (emitError) {
                                reader.cancel();
                                return function stop() {
                                    abortController.abort();
                                };
                            }
                        }
                        continue;
                    }

                    // Ignore comments and other SSE fields.
                    if (line.startsWith(":")) {
                        continue;
                    }

                    if (line.startsWith("event:")) {
                        // `event:` may be followed by a single space.
                        eventType = line.startsWith("event: ") ? line.slice(7) : line.slice(6);
                        continue;
                    }

                    if (line.startsWith("data:")) {
                        // `data:` may be followed by a single space.
                        const data = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
                        dataLines.push(data);
                    }
                }
            }

            // Flush a trailing event if the stream ended without a final blank line.
            if (dataLines.length > 0) {
                const data = dataLines.join("\n");
                const shouldEmit = eventType === null || eventType === "notification";
                if (shouldEmit && data.trim().length > 0) {
                    emit("notification", data);
                }
            }
        } catch (e) {
            if (!(e instanceof Error && e.name === "AbortError")) {
                logger.error("Notification proxy: Connection error:", e);
            }
        } finally {
            lock.set(false);
        }

        return function stop() {
            abortController.abort();
        };
    });
};
