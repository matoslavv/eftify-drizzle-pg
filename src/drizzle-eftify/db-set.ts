import {
	InferInsertModel,
	InferSelectModel,
	SQL,
	SelectedFields,
	ValueOrArray,
	and
} from 'drizzle-orm'
import { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core'
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { DbContext } from './db-context'
import { DbEntity } from './db-entity'
import { DbQueryCommon } from './db-query-common'
import { DbQueryRelation } from './db-query-relation'
import { DbQueryable } from './queryable/db-queryable'

export class DbSet<TDataModel extends any, TTable extends AnyPgTable, TEntity extends DbEntity<TDataModel, TTable>> {
	private _entity: TEntity
	private _context: WeakRef<DbContext>
	private _pendingWhere: any
	private _pendingRelations!: DbQueryRelation[]

	constructor(context: DbContext, entity: TEntity) {
		this._context = new WeakRef(context)
		this._entity = entity;
	}

	get context(): DbContext {
		return this._context?.deref() as DbContext
	}

	get db(): PostgresJsDatabase<any> {
		return this.context?.db as any
	}

	count(): Promise<number> {
		const db = this.db
		return new DbQueryable(db, this.createEmptyQuery(), 1).count()
	}

	async sum(
		builder: (aliases: TEntity) => ValueOrArray<AnyPgColumn | SQL | SQL.Aliased>
	): Promise<number> {
		const db = this.db
		return new DbQueryable(db, this.createEmptyQuery(), 1).sum(builder as any)
	}

	async max(
		builder: (aliases: TEntity) => ValueOrArray<AnyPgColumn | SQL | SQL.Aliased>
	): Promise<number> {
		const db = this.db
		return new DbQueryable(db, this.createEmptyQuery(), 1).sum(builder as any)
	}

	where(where: (aliases: TEntity) => SQL | undefined): this {
		const db = this.db
		this._entity.subscribeNavigation((args) => {
			if (this._pendingRelations == null) {
				this._pendingRelations = []
			}

			this._pendingRelations.push(args.navigation)
		})

		const whereCondition = where(this._entity)
		this._entity.unsubscribeNavigation()
		if (!whereCondition) {
			return this
		}

		if (this._pendingWhere == null) {
			this._pendingWhere = whereCondition
		} else {
			this._pendingWhere = and(this._pendingWhere, whereCondition)
		}

		return this
	}

	select<TResult extends SelectedFields<any, any>>(
		callbackfn: (value: TEntity) => TResult
	): DbQueryable<TResult> {
		const db = this.db
		const relationArr: DbQueryRelation[] = []
		this._entity.subscribeNavigation((args) => {
			relationArr.push(args.navigation)
		})

		const columns = callbackfn(this._entity)
		DbQueryCommon.ensureColumnAliased(columns, false)
		this._entity.unsubscribeNavigation()
		let select = this.createQuery(columns)

		try {
			select = DbQueryCommon.buildRelations(select, relationArr)
		} catch (error) {
			//Might have been build in previous step
		}

		return new DbQueryable(db, select, 1)
	}

	async firstOrDefault(): Promise<InferSelectModel<TTable>> {
		const retVal = await this.createEmptyQuery().limit(1)
		return retVal[0] as any
	}

	async toList(): Promise<InferSelectModel<TTable>[]> {
		return (await this.createEmptyQuery()) as any
	}

	insert(value: InferInsertModel<TTable> | InferInsertModel<TTable>[]) {
		return this.db.insert(this._entity.table as any).values(value)
	}

	update(value: Partial<InferInsertModel<TTable>>) {
		let query = this.db.update(this._entity.table).set(value as any)
		if (this._pendingWhere != null) {
			query = query.where(this._pendingWhere) as any
		}

		if (this._pendingRelations?.length > 0) {
			throw 'Update with relations not supported'
		}

		this._pendingWhere = null
		this._pendingRelations = null as any
		return query
	}

	delete() {
		if (this._pendingWhere == null) {
			throw 'Deleting entire entity is not supported due to security reasons'
		}

		let query = this.db.delete(this._entity.table).where(this._pendingWhere)
		if (this._pendingRelations?.length > 0) {
			throw 'Update with relations not supported'
		}

		return query
	}

	deleteAll() {
		let query = this.db.delete(this._entity.table)
		if (this._pendingRelations?.length > 0) {
			throw 'Update with relations not supported'
		}

		return query
	}

	getUnderlyingEntity(): TEntity {
		return this._entity
	}

	private createEmptyQuery() {
		return this.createQuery(undefined as any)
	}

	private createQuery<TColumns extends SelectedFields<any, any>>(columns: TColumns) {
		let select = this.db.select(columns).from(this._entity.table)
		if (this._pendingWhere != null) {
			select = select.where(this._pendingWhere) as any
		}

		if (this._pendingRelations?.length > 0) {
			select = DbQueryCommon.buildRelations(select as any, this._pendingRelations) as any
		}

		this._pendingWhere = null
		this._pendingRelations = null as any
		return select
	}
}
