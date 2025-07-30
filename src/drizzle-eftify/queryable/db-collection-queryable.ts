import { SQL, SQLChunk, SelectedFields, StringChunk, ValueOrArray, and, sql } from 'drizzle-orm'
import { SelectionProxyHandler } from 'drizzle-orm/selection-proxy'
import { DbQueryCommon } from '../db-query-common'
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { AnyPgColumn } from 'drizzle-orm/pg-core'
import { SelectResult } from 'drizzle-orm/query-builders/select.types'
import { EftifyCollectionJoinDeclaration } from '../data-contracts'

let counter = 0

export class DbCollectionQueryable<TSelection extends SelectedFields<any, any>> {
	private _db: PostgresJsDatabase<any>
	private _baseQuery: any
	private _level: number

	constructor(db: PostgresJsDatabase<any>, baseQuery: any, level: number) {
		this._db = db
		this._level = level
		this._baseQuery = baseQuery
	}

	count(): SQL<number> {
		const id = `fnlsq${counter++}`
		const subq = this._baseQuery.as(id)
		return sql<number>`(SELECT COUNT(*) from ${subq})`
	}

	sum(
		builder: (aliases: TSelection) => ValueOrArray<AnyPgColumn | SQL | SQL.Aliased>
	): SQL<number> {
		const id = `fnlsq${counter++}`
		const subq = this._baseQuery.as(id)

		return sql<number>`(SELECT COALESCE(sum(${builder(subq as any)}),0) from ${subq})`
	}

	select<TResult extends SelectedFields<any, any>>(selector: (value: TSelection) => TResult) {
		const subquery = this.buildSubquery()
		const columns = selector(subquery)
		DbQueryCommon.ensureColumnAliased(columns, true, null)
		let select = this._db.select(columns).from(subquery)

		return new DbCollectionQueryable(this._db, select, this._level + 1)
	}

	selectDistinct<TResult extends SelectedFields<any, any>>(selector: (value: TSelection) => TResult) {
		const subquery = this.buildSubquery()
		const columns = selector(subquery)
		DbQueryCommon.ensureColumnAliased(columns, true, null)
		let select = this._db.selectDistinct(columns).from(subquery)

		return new DbCollectionQueryable(this._db, select, this._level + 1)
	}

	toList(columnName: string): SQL<SelectResult<TSelection, 'multiple', any>[]> {
		const seq = counter++
		const id = `fnlsq${seq}`
		const subq = this._baseQuery.as(id)

		if (columnName == null) {
			columnName = 'list' + seq
		}

		const retQuery = sql<SelectResult<TSelection, 'multiple', any>[]>`(SELECT COALESCE(json_agg(IDREPLACE.*),'[]') from ${subq})`;
		(retQuery as any).queryChunks[0].value[0] = (retQuery as any).queryChunks[0].value[0].replace('IDREPLACE', id);

		const joinDeclaration: EftifyCollectionJoinDeclaration = {
			columnName: columnName,
			isCollectionDeclaration: true,
			sql: retQuery,
			id: id,
		}

		return joinDeclaration as any;
	}

	toNumberList(): SQL<number[]> {
		let propName: string = null as any;
		for (const key in this._baseQuery['_']['selectedFields']) {
			propName = key
			break
		}

		const subq = this._baseQuery.as(`fnlsq${counter++}`)
		const col = subq[propName]
		return sql`(SELECT COALESCE(array_agg(${col}), '{}') from ${subq})`
	}

	toStringList(): SQL<string[]> {
		let propName: string = null as any;
		for (const key in this._baseQuery['_']['selectedFields']) {
			propName = key
			break
		}

		const subq = this._baseQuery.as(`fnlsq${counter++}`)
		const col = subq[propName]
		return sql`(SELECT COALESCE(array_agg(${col}), '{}') from ${subq})`
	}

	firstOrDefault(): SQL<TSelection> {
		throw 'Not yet implemented, nor used'
	}

	where(where: (aliases: TSelection) => SQL | undefined): DbCollectionQueryable<TSelection> {
		let query: any
		const oldWhere = (this._baseQuery as any).config.where
		if (oldWhere == null) {
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
			} else {
				query = this._baseQuery.where(and(oldWhere, where as any))
			}
		}

		return this.createSelfInstance(query)
	}

	skip(offset: number): DbCollectionQueryable<TSelection> {
		return this.createSelfInstance(this._baseQuery.offset(offset))
	}

	take(count: number): DbCollectionQueryable<TSelection> {
		return this.createSelfInstance(this._baseQuery.limit(count))
	}

	orderBy(
		builder: (aliases: TSelection) => ValueOrArray<AnyPgColumn | SQL | SQL.Aliased>
	): DbCollectionQueryable<TSelection> {
		return this.createSelfInstance(this._baseQuery.orderBy(builder as any))
	}

	toSQL() {
		return this._db.select().from(this.buildSubquery()).toSQL()
	}

	private createSelfInstance(query: any): DbCollectionQueryable<TSelection> {
		return new DbCollectionQueryable(this._db, query, this._level)
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
