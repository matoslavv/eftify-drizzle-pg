import { SelectedFields, SQL, WithSubquery } from 'drizzle-orm'
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { DbQueryable } from '../queryable/db-queryable'

/**
 * Represents a Common Table Expression (CTE) that can be used in queries.
 * Provides full TypeScript typing for CTE columns and enables joining with other tables.
 */
export class DbCte<TSelection extends SelectedFields<any, any>> {
	private _cte: WithSubquery<any, any>
	private _db: PostgresJsDatabase<any>

	constructor(db: PostgresJsDatabase<any>, cte: WithSubquery<any, any>) {
		this._db = db
		this._cte = cte
	}

	/**
	 * Access the underlying Drizzle CTE object for advanced usage
	 */
	get cte(): WithSubquery<any, any> {
		return this._cte
	}

	/**
	 * Get the CTE as a typed object that can be used in selects and joins
	 */
	get table(): TSelection {
		return this._cte as any
	}

	/**
	 * Create a queryable from this CTE
	 */
	toQueryable(): DbQueryable<TSelection> {
		const select = this._db.select().from(this._cte as any)
		return new DbQueryable(this._db, select, 1)
	}
}

/**
 * Builder for creating multiple CTEs that can reference each other
 */
export class DbCteBuilder {
	private _db: PostgresJsDatabase<any>
	private _ctes: WithSubquery<any, any>[] = []

	constructor(db: PostgresJsDatabase<any>) {
		this._db = db
	}

	/**
	 * Add a CTE to the builder
	 * @param name The name of the CTE
	 * @param queryable The queryable to use as the CTE source
	 * @returns A typed CTE that can be used in subsequent queries
	 */
	with<TSelection extends SelectedFields<any, any>>(
		name: string,
		queryable: DbQueryable<TSelection>
	): DbCte<TSelection> {
		const drizzleQuery = queryable.toDrizzleQuery()
		const cte = this._db.$with(name).as(drizzleQuery)
		this._ctes.push(cte)
		return new DbCte<TSelection>(this._db, cte)
	}

	/**
	 * Get all registered CTEs
	 */
	getCtes(): WithSubquery<any, any>[] {
		return this._ctes
	}
}
