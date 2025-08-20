import { sql } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";

/**
 * Creates a SQL condition to check if a flag is set
 * @example: hasFlag(p.state, UserStateFlags.Active)
 */
export const hasFlag = (column: PgColumn, flag: number) => {
	return sql`(${column} & ${flag}) != 0`;
}

/**
 * Creates a SQL condition to check if ALL flags are set
 * @example: hasAllFlags(p.state, UserStateFlags.Active | UserStateFlags.Verified)
 */
export const hasAllFlags = (column: PgColumn, flags: number) => {
	return sql`(${column} & ${flags}) = ${flags}`;
}

/**
 * Creates a SQL condition to check if ANY of the flags is set
 * @example: hasAnyFlag(p.state, UserStateFlags.Slave | UserStateFlags.Unsynced)
 */
export const hasAnyFlag = (column: PgColumn, flags: number) => {
	return sql`(${column} & ${flags}) != 0`;
}

/**
 * Creates a SQL condition to check if flag is NOT set
 * @example: doesNotHaveFlag(p.state, UserStateFlags.Active)
 */
export const doesNotHaveFlag = (column: PgColumn, flag: number) => {
	return sql`(${column} & ${flag}) = 0`;
}
