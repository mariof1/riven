import { auth } from './auth';
import { getUsersCount } from './functions';

let bootstrapAttempt: Promise<void> | null = null;

export async function maybeBootstrapAdminFromEnv(): Promise<void> {
        if (!bootstrapAttempt) {
                bootstrapAttempt = (async () => {
                        const username = process.env.RIVEN_ADMIN_USERNAME;
                        const email = process.env.RIVEN_ADMIN_EMAIL;
                        const password = process.env.RIVEN_ADMIN_PASSWORD;

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
                                                role: 'admin',
                                                data: {
                                                        username
                                                }
                                        }
                                });
                                // eslint-disable-next-line no-console
                                console.log(`[auth] Bootstrapped initial admin user '${username}' from env.`);
                        } catch (error) {
                                // eslint-disable-next-line no-console
                                console.warn('[auth] Failed to bootstrap admin user from env:', error);
                        }
                })();
        }

        await bootstrapAttempt;
}
