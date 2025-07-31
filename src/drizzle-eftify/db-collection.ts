import { SQL, SelectedFields, ValueOrArray, and, eq } from 'drizzle-orm'
import { AnyPgColumn, AnyPgTable, PgColumn } from 'drizzle-orm/pg-core'
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { DbContext } from './db-context'
import { DbEntity } from './db-entity'
import { DbQueryCommon } from './db-query-common'
import { DbQueryRelation, DbQueryRelationRecord } from './db-query-relation'
import { DbCollectionQueryable } from './queryable/db-collection-queryable'

type KeyOfType<T, V> = keyof { [P in keyof T as T[P] extends V ? P : never]: any }
type OnlyTableColumns<T> = {
	[P in KeyOfType<T, PgColumn<any, any, any>>]: T[P]
}

export class DbCollection<TEntity extends DbEntity<any, AnyPgTable>> {
	private _entity: TEntity
	private _parentEntity: WeakRef<any>
	private _relation: WeakRef<DbQueryRelationRecord>
	private _context: WeakRef<DbContext>
	private _pendingWhere: any
	private _pendingRelations!: DbQueryRelation[]
	private _uniqueRelKey: string

	constructor(
		context: DbContext,
		parentEntity: any,
		relation: DbQueryRelationRecord,
		entity: TEntity,
		uniqueRelKey: string
	) {
		this._context = new WeakRef(context)
		this._parentEntity = new WeakRef(parentEntity)
		this._relation = new WeakRef(relation)
		this._entity = entity;
		this._uniqueRelKey = uniqueRelKey;
	}

	get context(): DbContext {
		return this._context?.deref() as DbContext
	}

	get db(): PostgresJsDatabase<any> {
		return this.context?.db as any
	}

	count(): SQL<number> {
		return new DbCollectionQueryable(this.db, this.createEmptyQuery(), 1).count()
	}

	sum(builder: (aliases: TEntity) => ValueOrArray<AnyPgColumn | SQL | SQL.Aliased>): SQL<number> {
		return new DbCollectionQueryable(this.db, this.createEmptyQuery(), 1).sum(builder as any)
	}

	toList(): SQL<OnlyTableColumns<typeof this._entity>[]> {
		return new DbCollectionQueryable(this.db, this.createEmptyQuery(), 1).toList(null as any) as any
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

		if (this._pendingWhere == null) {
			this._pendingWhere = whereCondition
		} else {
			this._pendingWhere = and(this._pendingWhere, whereCondition)
		}

		return this
	}

	select<TResult extends SelectedFields<any, any>>(
		callbackfn: (value: TEntity) => TResult
	): DbCollectionQueryable<TResult> {
		const db = this.db
		const relationArr: DbQueryRelation[] = []
		this._entity.subscribeNavigation((args) => {
			relationArr.push(args.navigation)
		})

		const columns = callbackfn(this._entity)
		DbQueryCommon.ensureColumnAliased(columns, true, relationArr)
		this._entity.unsubscribeNavigation()

		let select = this.createQuery(columns)
		select = DbQueryCommon.buildRelations(select, relationArr);
		DbQueryCommon.setFormatColumnsOnBaseQuery(this, select, columns);
		return new DbCollectionQueryable(db, select, 1)
	}

	private createEmptyQuery() {
		return this.createQuery(undefined as any)
	}

	private createQuery<TColumns extends SelectedFields<any, any>>(columns: TColumns) {
		const relation = this._relation.deref()
		const parent = this._parentEntity.deref()

		if (relation == null || parent == null) {
			throw 'Parent or relation reference lost...should not happen'
		}

		const joinOn = DbQueryCommon.createJoinOn({
			callingEntity: parent,
			childEntity: this._entity,
			relation: relation,
			uniqueKey: this._uniqueRelKey,
			joinDeclaration: null
		});

		let select = this.db
			.select(columns)
			.from(this._entity.table as any)
			.where(joinOn)

		if (this._pendingWhere != null) {
			select = (select as any).where(this._pendingWhere)
		}

		if (this._pendingRelations?.length > 0) {
			select = DbQueryCommon.buildRelations(select, this._pendingRelations)
		}

		this._pendingWhere = null
		this._pendingRelations = null as any
		return select
	}
}
