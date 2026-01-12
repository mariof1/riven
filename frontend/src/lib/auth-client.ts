import { createAuthClient } from 'better-auth/react';
import { adminClient, genericOAuthClient, lastLoginMethodClient, usernameClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

export const authClient = createAuthClient({
        plugins: [usernameClient(), adminClient(), passkeyClient(), lastLoginMethodClient(), genericOAuthClient()]
});

export const { useSession } = authClient;
