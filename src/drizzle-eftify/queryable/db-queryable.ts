import { SQL, SelectedFields, ValueOrArray, and, sql } from 'drizzle-orm'
import { SelectionProxyHandler } from 'drizzle-orm/selection-proxy'
import { DbQueryCommon } from '../db-query-common'
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { GroupedDbQueryable } from '../grouped-db-queryable'
import { AnyPgColumn } from 'drizzle-orm/pg-core'
import { SelectResult } from 'drizzle-orm/query-builders/select.types'
import DbEftifyConfig from '../db-eftify-config'

export class DbQueryable<TSelection extends SelectedFields<any, any>> {
	private _db: PostgresJsDatabase<any>
	private _baseQuery: any
	private _level: number

	constructor(db: PostgresJsDatabase<any>, baseQuery: any, level: number) {
		this._db = db
		this._level = level
		this._baseQuery = baseQuery
	}

	async count(): Promise<number> {
		const retVal = await this._db
			.select({ count: sql<number>`count(*)::integer` })
			.from(this.buildSubquery())
		return retVal[0].count
	}

	async sum(
		builder: (aliases: TSelection) => ValueOrArray<AnyPgColumn | SQL | SQL.Aliased>
	): Promise<number> {
		const subquery = this.buildSubquery()
		const retVal = await this._db
			.select({ count: sql<number>`sum(${builder(subquery)})` })
			.from(subquery)
		return retVal[0].count
	}

	async max(
		builder: (aliases: TSelection) => ValueOrArray<AnyPgColumn | SQL | SQL.Aliased>
	): Promise<number> {
		const subquery = this.buildSubquery()
		const retVal = await this._db
			.select({ count: sql<number>`max(${builder(subquery)})` })
			.from(subquery)
		return retVal[0].count
	}

	select<TResult extends SelectedFields<any, any>>(
		selector: (value: TSelection) => TResult
	): DbQueryable<TResult> {
		const subquery = this.buildSubquery()
		const columns = selector(subquery)
		DbQueryCommon.ensureColumnAliased(columns, false, null)
		let select = this._db.select(columns).from(subquery)

		return new DbQueryable(this._db, select, this._level + 1)
	}

	groupBy<TResult extends SelectedFields<any, any>>(selector: (value: TSelection) => TResult) {
		const subquery = this.buildSubquery();
		const groupColumns = selector(subquery);
		DbQueryCommon.ensureColumnAliased(groupColumns, false, null);
		type SelectedType = ReturnType<typeof this.createSelect<typeof groupColumns>>;
		type BaseType = TSelection;

		return new GroupedDbQueryable<BaseType, SelectedType, SelectedType>(
			this._db,
			(null as any) as SelectedType,
			(this._baseQuery as any) as BaseType,
			this._level + 1,
			(groupColumns as any) as SelectedType,
			subquery
		)
	}


	async firstOrDefault(): Promise<SelectResult<TSelection, 'multiple', any>> {
		if (DbEftifyConfig.traceEnabled) {
			const msg = DbQueryCommon.getTraceMessage('firstOrDefault');
			console.time(msg);
			const resultArr = await this._baseQuery.limit(1).execute();
			console.timeEnd(msg);
			return resultArr[0];
		} else {
			return (await this._baseQuery.limit(1).execute())[0];
		}
	}

	async toList(): Promise<SelectResult<TSelection, 'multiple', any>[]> {
		if (DbEftifyConfig.traceEnabled) {
			const msg = DbQueryCommon.getTraceMessage('toList');
			console.time(msg);
			const retVal = await this._baseQuery;
			console.timeEnd(msg);
			return retVal;
		} else {
			return await this._baseQuery;
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

	private createSelfInstance(query: any): DbQueryable<TSelection> {
		return new DbQueryable(this._db, query, this._level)
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
}
