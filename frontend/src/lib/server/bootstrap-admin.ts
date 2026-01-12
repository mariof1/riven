import { env } from "$env/dynamic/private";
import { auth } from "$lib/server/auth";
import { getUsersCount } from "$lib/server/functions";
import { createScopedLogger } from "$lib/logger";

const logger = createScopedLogger("bootstrap-admin");

let bootstrapAttempt: Promise<void> | null = null;

export async function maybeBootstrapAdminFromEnv(): Promise<void> {
    if (!bootstrapAttempt) {
        bootstrapAttempt = (async () => {
            const username = env.RIVEN_ADMIN_USERNAME;
            const email = env.RIVEN_ADMIN_EMAIL;
            const password = env.RIVEN_ADMIN_PASSWORD;

            if (!username || !email || !password) {
                return;
            }

            const count = await getUsersCount();
            if (count !== 0) {
                return;
            }

            try {
                await auth.api.createUser({
                    body: {
                        name: username,
                        email,
                        password,
                        role: "admin",
                        data: {
                            username
                        }
                    }
                });

                logger.info(`Bootstrapped initial admin user '${username}' from env.`);
            } catch (error) {
                // Don't block the request if the user already exists (race / restart),
                // or if createUser fails for any reason.
                logger.warn("Failed to bootstrap admin user from env:", error);
            }
        })();
    }

    await bootstrapAttempt;
}
