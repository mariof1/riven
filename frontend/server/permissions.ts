import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';

const statement = {
        ...defaultStatements,
        item: ['request', 'delete', 'reset', 'pause', 'retry', 'scrape']
} as const;

export const ac = createAccessControl(statement);

export const admin = ac.newRole({
        item: ['request', 'delete', 'reset', 'pause', 'retry', 'scrape'],
        ...adminAc.statements
});

export const user = ac.newRole({
        item: ['request']
});

export const manager = ac.newRole({
        item: ['request', 'delete', 'reset', 'pause', 'retry', 'scrape']
});
