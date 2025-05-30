import type { Config } from 'drizzle-kit';
import 'dotenv/config';

const getEnv = () => {
    const prc = (process || {}) as any;
    return (prc as any).env;
};

export default {
    dialect: 'postgresql',
    dbCredentials: {
        url: getEnv().DB_URL as any,
    },
    schema: 'debug/schema.ts',
    out: 'drizzle',
    verbose: true,
} satisfies Config;
