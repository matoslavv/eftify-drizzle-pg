import { SQL, SelectedFields, ValueOrArray, and, sql, WithSubquery } from 'drizzle-orm'
import { SelectionProxyHandler } from 'drizzle-orm/selection-proxy'
import { DbQueryCommon } from '../db-query-common'
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { GroupedDbQueryable } from '../grouping/grouped-db-queryable'
import { AnyPgColumn } from 'drizzle-orm/pg-core'
import { SelectResult } from 'drizzle-orm/query-builders/select.types'
import DbEftifyConfig from '../db-eftify-config'
import type { DbSet } from '../db-set'
import type { DbEntity } from '../db-entity'

export class DbQueryable<TSelection extends SelectedFields<any, any>> {
	private _db: PostgresJsDatabase<any>
	private _baseQuery: any
	private _level: number
	private _ctes: WithSubquery<any, any>[] = []

	constructor(db: PostgresJsDatabase<any>, baseQuery: any, level: number, ctes?: WithSubquery<any, any>[]) {
		this._db = db
		this._level = level
		this._baseQuery = baseQuery
		if (ctes) {
			this._ctes = ctes
		}
	}

	async count(): Promise<number> {
		let db: any = this._db

		// Apply CTEs at the database level if present
		if (this._ctes.length > 0) {
			db = this._db.with(...this._ctes)
		}

		const retVal = await db
			.select({ count: sql<number>`count(*)::integer` })
			.from(this.buildSubquery())

		return retVal[0].count
	}

	async sum(
		builder: (aliases: TSelection) => ValueOrArray<AnyPgColumn | SQL | SQL.Aliased>
	): Promise<number> {
		const subquery = this.buildSubquery()
		let db: any = this._db

		// Apply CTEs at the database level if present
		if (this._ctes.length > 0) {
			db = this._db.with(...this._ctes)
		}

		const retVal = await db
			.select({ count: sql<number>`sum(${builder(subquery)})` })
			.from(subquery)

		return retVal[0].count
	}

	async max(
		builder: (aliases: TSelection) => ValueOrArray<AnyPgColumn | SQL | SQL.Aliased>
	): Promise<number> {
		const subquery = this.buildSubquery()
		let db: any = this._db

		// Apply CTEs at the database level if present
		if (this._ctes.length > 0) {
			db = this._db.with(...this._ctes)
		}

		const retVal = await db
			.select({ count: sql<number>`max(${builder(subquery)})` })
			.from(subquery)

		return retVal[0].count
	}

	select<TResult extends SelectedFields<any, any>>(
		selector: (value: TSelection) => TResult
	): DbQueryable<TResult> {
		const subquery = this.buildSubquery();
		DbQueryCommon.restoreSubqueryFormatColumnsFromBaseQuery(this._baseQuery, subquery);
		const columns = selector(subquery)
		DbQueryCommon.ensureColumnAliased(columns, false, null)

		let db: any = this._db

		// Apply CTEs at the database level if present
		if (this._ctes.length > 0) {
			db = this._db.with(...this._ctes)
		}

		let select = db.select(columns).from(subquery)

		DbQueryCommon.setFormatColumnsOnBaseQuery(this, select, columns);
		return new DbQueryable(this._db, select, this._level + 1, this._ctes)
	}

	selectDistinct<TResult extends SelectedFields<any, any>>(
		selector: (value: TSelection) => TResult
	): DbQueryable<TResult> {
		const subquery = this.buildSubquery()
		DbQueryCommon.restoreSubqueryFormatColumnsFromBaseQuery(this._baseQuery, subquery);
		const columns = selector(subquery)
		DbQueryCommon.ensureColumnAliased(columns, false, null)

		let db: any = this._db

		// Apply CTEs at the database level if present
		if (this._ctes.length > 0) {
			db = this._db.with(...this._ctes)
		}

		let select = db.selectDistinct(columns).from(subquery)

		DbQueryCommon.setFormatColumnsOnBaseQuery(this, select, columns);
		return new DbQueryable(this._db, select, this._level + 1, this._ctes)
	}

	groupBy<TResult extends SelectedFields<any, any>>(selector: (value: TSelection) => TResult) {
		const subquery = this.buildSubquery();
		const groupColumns = selector(subquery);
		DbQueryCommon.ensureColumnAliased(groupColumns, false, null);
		type SelectedType = ReturnType<typeof this.createSelect<typeof groupColumns>>;
		type BaseType = TSelection;

		return new GroupedDbQueryable(
			this._db,
			(null as any) as SelectedType,
			(this._baseQuery as any) as BaseType,
			this._level + 1,
			(groupColumns as any) as SelectedType,
			subquery
		)
	}


	async firstOrDefault(): Promise<SelectResult<TSelection, 'multiple', any>> {
		let query = this._baseQuery

		// Apply CTEs if present - need to rebuild query with CTEs
		if (this._ctes.length > 0) {
			query = this.rebuildQueryWithCtes()
		}

		if (DbEftifyConfig.traceEnabled) {
			const msg = DbQueryCommon.getTraceMessage('firstOrDefault');
			console.time(msg);
			const resultArr = await query.limit(1).execute();
			console.timeEnd(msg);
			DbQueryCommon.mapCollectionValuesFromDriver(query._formatCollections || this._baseQuery._formatCollections, resultArr);
			return resultArr[0];
		} else {
			const resultArr = await query.limit(1).execute();
			DbQueryCommon.mapCollectionValuesFromDriver(query._formatCollections || this._baseQuery._formatCollections, resultArr);
			return resultArr[0];
		}
	}

	async toList(): Promise<SelectResult<TSelection, 'multiple', any>[]> {
		let query = this._baseQuery

		// Apply CTEs if present - need to rebuild query with CTEs
		if (this._ctes.length > 0) {
			query = this.rebuildQueryWithCtes()
		}

		if (DbEftifyConfig.traceEnabled) {
			const msg = DbQueryCommon.getTraceMessage('toList');
			console.time(msg);
			const retVal = await query;
			console.timeEnd(msg);
			DbQueryCommon.mapCollectionValuesFromDriver(query._formatCollections || this._baseQuery._formatCollections, retVal);
			return retVal;
		} else {
			const retVal = await query;
			DbQueryCommon.mapCollectionValuesFromDriver(query._formatCollections || this._baseQuery._formatCollections, retVal);
			return retVal;
		}
	}

	where(where: (aliases: TSelection) => SQL | undefined): DbQueryable<TSelection> {
		let query: any
		const oldWhere = (this._baseQuery as any).config.where
		if (!oldWhere) {
			query = this._baseQuery.where(where as any)
		} else {
			if (typeof where === 'function') {
				query = this._baseQuery.where(
					and(
						oldWhere,
						where(
							new Proxy(
								(this._baseQuery as any).config.fields,
								new SelectionProxyHandler({
									sqlAliasedBehavior: 'sql',
									sqlBehavior: 'sql'
								})
							)
						)
					)
				)
			} else if (where) {
				query = this._baseQuery.where(and(oldWhere, where as any))
			}
		}

		return this.createSelfInstance(query)
	}

	skip(offset: number): DbQueryable<TSelection> {
		return this.createSelfInstance(this._baseQuery.offset(offset))
	}

	take(count: number): DbQueryable<TSelection> {
		return this.createSelfInstance(this._baseQuery.limit(count))
	}

	orderBy(
		builder: (aliases: TSelection) => ValueOrArray<AnyPgColumn | SQL | SQL.Aliased>
	): DbQueryable<TSelection> {
		return this.createSelfInstance(
			Array.isArray(builder)
				? this._baseQuery.orderBy(...(builder as any))
				: this._baseQuery.orderBy(builder as any)
		)
	}

	toDrizzleQuery() {
		return this._db.select().from(this.buildSubquery())
	}

	toSQL() {
		return this._db.select().from(this.buildSubquery()).toSQL()
	}

	/**
	 * Add CTEs to this query. CTEs can be referenced in subsequent operations.
	 * @param ctes Array of CTE definitions from DbCteBuilder
	 */
	with(...ctes: WithSubquery<any, any>[]): DbQueryable<TSelection> {
		const newCtes = [...this._ctes, ...ctes]
		return new DbQueryable(this._db, this._baseQuery, this._level, newCtes)
	}

	/**
	 * Perform a left join with a CTE, returning a combined queryable.
	 */
	leftJoin<TCteSelection extends SelectedFields<any, any>, TResult extends SelectedFields<any, any>>(
		cte: WithSubquery<any, any>,
		on: (current: TSelection, cte: TCteSelection) => SQL | undefined,
		selector: (current: TSelection, cte: TCteSelection) => TResult
	): DbQueryable<TResult>

	/**
	 * Perform a left join with a DbQueryable, returning a combined queryable.
	 */
	leftJoin<TCteSelection extends SelectedFields<any, any>, TResult extends SelectedFields<any, any>>(
		queryable: DbQueryable<TCteSelection>,
		on: (current: TSelection, cte: TCteSelection) => SQL | undefined,
		selector: (current: TSelection, cte: TCteSelection) => TResult
	): DbQueryable<TResult>

	/**
	 * Perform a left join with a DbSet, returning a combined queryable.
	 * This preserves the strong typing of the DbSet entity.
	 *
	 * @example
	 * const activePosts = dbContext.posts.where(p => eq(p.status, 'active'));
	 * const result = await someQueryable
	 *   .leftJoin(
	 *     activePosts,
	 *     (prev, post) => eq(prev.userId, post.authorId),  // post is fully typed!
	 *     (prev, post) => ({ userId: prev.userId, postId: post.id })
	 *   )
	 *   .toList();
	 */
	leftJoin<TJoinEntity extends DbEntity<any, any>, TResult extends SelectedFields<any, any>>(
		dbSet: DbSet<any, any, TJoinEntity>,
		on: (current: TSelection, joinEntity: TJoinEntity) => SQL | undefined,
		selector: (current: TSelection, joinEntity: TJoinEntity) => TResult
	): DbQueryable<TResult>

	leftJoin<TCteSelection extends SelectedFields<any, any>, TResult extends SelectedFields<any, any>>(
		cteOrQueryableOrSet: WithSubquery<any, any> | DbQueryable<TCteSelection> | DbSet<any, any, any>,
		on: (current: TSelection, cte: TCteSelection) => SQL | undefined,
		selector: (current: TSelection, cte: TCteSelection) => TResult
	): DbQueryable<TResult> {
		// Build a subquery from current query state
		const subquery = this.buildSubquery()
		DbQueryCommon.restoreSubqueryFormatColumnsFromBaseQuery(this._baseQuery, subquery)

		// Convert DbQueryable or DbSet to a CTE if needed
		let cte: WithSubquery<any, any>
		let additionalCtes: WithSubquery<any, any>[] = []

		if (cteOrQueryableOrSet instanceof DbQueryable) {
			// It's a DbQueryable - convert it to a CTE
			const queryableName = `subquery_${Date.now()}`
			cte = this._db.$with(queryableName).as(cteOrQueryableOrSet.toDrizzleQuery())
			additionalCtes.push(cte)
		} else if (cteOrQueryableOrSet?.constructor?.name === 'DbSet') {
			// It's a DbSet - convert it to a query first, then to a CTE
			// This preserves any where/orderBy conditions on the DbSet
			const dbSetQuery = (cteOrQueryableOrSet as any).createEmptyQuery()
			const queryableName = `dbset_${Date.now()}`
			cte = this._db.$with(queryableName).as(dbSetQuery)
			additionalCtes.push(cte)
		} else {
			// It's already a WithSubquery (CTE)
			cte = cteOrQueryableOrSet as WithSubquery<any, any>
		}

		// Track navigation properties (though subqueries typically don't have navigation)
		// This is here for consistency and potential edge cases
		const relationArr: any[] = []

		// Get the join condition
		const joinCondition = on(subquery, cte as any)

		// Get the combined columns
		const columns = selector(subquery, cte as any)

		// Only flatten if the user passed nested proxy objects (not individual column selections)
		const needsFlattening = DbQueryCommon.needsFlattening(columns)
		const finalColumns = needsFlattening ? DbQueryCommon.flattenProxyStructure(columns) : columns
		DbQueryCommon.ensureColumnAliased(finalColumns, false, relationArr)

		// Apply CTEs at database level if present
		let db: any = this._db
		const allCtes = [...this._ctes, ...additionalCtes]
		if (allCtes.length > 0) {
			db = this._db.with(...allCtes)
		}

		// Build the query: select combined columns from subquery joined with CTE
		let finalQuery = db.select(finalColumns).from(subquery)

		// Apply the join
		finalQuery = finalQuery.leftJoin(cte, joinCondition)

		// Build navigation relations (joins for foreign keys)
		// Note: Typically subqueries don't have navigation, but this is here for completeness
		if (relationArr.length > 0) {
			try {
				finalQuery = DbQueryCommon.buildRelations(finalQuery, relationArr)
			} catch (error) {
				// Might have been built in previous step
			}
		}

		DbQueryCommon.setFormatColumnsOnBaseQuery(this, finalQuery, finalColumns)
		return new DbQueryable(this._db, finalQuery, this._level + 1, allCtes)
	}

	/**
	 * Perform a left join with a CTE or table, then select columns
	 * @param cte The CTE to join
	 * @param on The join condition
	 * @param selector The columns to select from both the current query and CTE
	 * @deprecated Use leftJoin instead for better handling of ambiguous column names
	 */
	leftJoinSelect<TCteSelection extends SelectedFields<any, any>, TResult extends SelectedFields<any, any>>(
		cte: WithSubquery<any, any>,
		on: (current: TSelection, cte: TCteSelection) => SQL | undefined,
		selector: (current: TSelection, cte: TCteSelection) => TResult
	): DbQueryable<TResult> {
		return this.leftJoin(cte, on, selector)
	}

	private createSelfInstance(query: any): DbQueryable<TSelection> {
		return new DbQueryable(this._db, query, this._level, this._ctes)
	}

	private buildSubquery(): any {
		return this._baseQuery.as(`q${this._level}`)
	}

	private createSelect<TResult extends SelectedFields<any, any>>(
		subquery: any,
		columns: TResult
	) {
		return this._db.select(columns).from(subquery)
	}

	/**
	 * Rebuild the base query with CTEs applied at the database level
	 * This is necessary because CTEs must be applied before building the select
	 */
	private rebuildQueryWithCtes(): any {
		const config = (this._baseQuery as any).config
		const db: any = this._db.with(...this._ctes)

		// Rebuild the query with CTEs
		let query = db.select(config.fields).from(config.table)

		// Reapply all query modifiers
		if (config.where) {
			query = query.where(config.where)
		}

		if (config.joins && config.joins.length > 0) {
			for (const join of config.joins) {
				if (join.joinType === 'left') {
					query = query.leftJoin(join.table, join.on)
					if (join.lateral) {
						const joinsArr: any[] = query.config.joins
						joinsArr[joinsArr.length - 1].lateral = true
					}
				} else if (join.joinType === 'inner') {
					query = query.innerJoin(join.table, join.on)
				}
			}
		}

		if (config.orderBy && config.orderBy.length > 0) {
			query = query.orderBy(...config.orderBy)
		}

		if (config.limit !== undefined) {
			query = query.limit(config.limit)
		}

		if (config.offset !== undefined) {
			query = query.offset(config.offset)
		}

		if (config.distinct) {
			// Note: Can't change to distinct after select is built
			// This is a limitation we'll document
		}

		// Preserve format collections
		query._formatCollections = this._baseQuery._formatCollections

		return query
	}
}
