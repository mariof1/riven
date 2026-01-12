import { db } from './db';
import { user } from './schema';

export async function getUsersCount() {
        return db.$count(user);
}
