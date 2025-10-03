import { SQL, sql } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";

type FlagType<C extends PgColumn> = C["_"]["data"] & number;

/**
 * Creates a SQL condition to check if a flag is set
 * @example: hasFlag(p.state, UserStateFlags.Active)
 */
export const flagHas = <C extends PgColumn>(
	column: C,
	flag: FlagType<C>,
): SQL<boolean> => {
	return sql`(${column} & ${flag}) != 0`;
}

/**
 * Creates a SQL condition to check if ALL flags are set
 * @example: hasAllFlags(p.state, UserStateFlags.Active | UserStateFlags.Verified)
 */
export const flagHasAll = <C extends PgColumn>(
	column: C,
	flags: FlagType<C>,
): SQL<boolean> => {
	return sql`(${column} & ${flags}) = ${flags}`;
}

/**
 * Creates a SQL condition to check if ANY of the flags is set
 * @example: hasAnyFlag(p.state, UserStateFlags.Slave | UserStateFlags.Unsynced)
 */
export const flagHasAny = <C extends PgColumn>(
	column: C,
	flags: FlagType<C>,
): SQL<boolean> => {
	return sql`(${column} & ${flags}) != 0`;
}

/**
 * Creates a SQL condition to check if flag is NOT set
 * @example: doesNotHaveFlag(p.state, UserStateFlags.Active)
 */
export const flagHasNone = <C extends PgColumn>(
	column: C,
	flag: FlagType<C>,
): SQL<boolean> => {
	return sql`(${column} & ${flag}) = 0`;
}
