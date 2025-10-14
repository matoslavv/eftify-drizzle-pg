import { SelectedFields, WithSubquery, sql } from 'drizzle-orm'
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

	/**
	 * Creates an aggregation CTE that groups by the specified key(s) and aggregates remaining fields using json_agg
	 * @param name The name of the new CTE
	 * @param sourceCte The source CTE to aggregate
	 * @param keySelector Function that selects the grouping key(s) from the CTE
	 * @param aggregationAlias Optional alias for the aggregated array column (defaults to 'items')
	 * @returns A new DbCte with the aggregated structure
	 *
	 * @example
	 * // Given a CTE with {productId, dailyPrice, categoryId}
	 * const productsCte = builder.with('products', query);
	 * const aggregated = builder.withAggregation(
	 *   'aggregatedProducts',
	 *   productsCte,
	 *   p => ({ productId: p.productId })
	 * )
	 * // Results in: {productId, items: [{dailyPrice, categoryId}]}
	 */
	withAggregation<TSelection extends SelectedFields<any, any>, TKey extends SelectedFields<any, any>>(
		name: string,
		sourceCte: DbCte<TSelection>,
		keySelector: (value: TSelection) => TKey,
		aggregationAlias: string = 'items'
	): DbCte<TKey & { [key: string]: any }> {
		// Get the CTE table reference
		const cteTable = sourceCte.table

		// Get the key columns
		const keyColumns = keySelector(cteTable)

		// Build the list of all columns to exclude from aggregation (the key columns)
		const keyNames = new Set(Object.keys(keyColumns))

		// Get all columns from the source CTE
		const sourceCteInternal = sourceCte.cte as any
		const allColumns = sourceCteInternal._?.selectedFields || {}

		// Build json_build_object arguments for non-key columns
		const jsonBuildArgs: any[] = []
		for (const colName in allColumns) {
			if (!keyNames.has(colName)) {
				const column = cteTable[colName as keyof TSelection]
				jsonBuildArgs.push(sql`${sql.raw(`'${colName}'`)}`)
				jsonBuildArgs.push(column)
			}
		}

		// Build the aggregation query
		const aggregatedQuery = this._db
			.select({
				...keyColumns,
				[aggregationAlias]: jsonBuildArgs.length > 0
					? sql`COALESCE(json_agg(json_build_object(${sql.join(jsonBuildArgs, sql`, `)})), '[]'::json)`.as(aggregationAlias)
					: sql`'[]'::json`.as(aggregationAlias)
			})
			.from(sourceCte.cte as any)
			.groupBy(...Object.values(keyColumns) as any[])

		// Create a new CTE from this aggregated query
		const newCte = this._db.$with(name).as(aggregatedQuery)
		this._ctes.push(newCte)

		return new DbCte(this._db, newCte)
	}
}
