import { AnyPgTable } from 'drizzle-orm/pg-core'
import { DbContext } from './db-context'
import { DbQueryRelation } from './db-query-relation'
import { AnyColumn, InferModelFromColumns, InferSelectModel, SQL, sql } from 'drizzle-orm'
import { jsonbSelect } from './helpers/jsonbSelect'

export abstract class DbEntity<TEntity extends any, TTable extends AnyPgTable> {
	private _context: WeakRef<DbContext>
	private _navigationCb!: (args: { navigation: DbQueryRelation }) => void

	constructor(context: DbContext) {
		this._context = new WeakRef(context)
	}

	/** @internal */
	private get context(): DbContext {
		return this._context.deref() as any
	}

	private changeTableToSubquery(alias: string) {
		const subquery = this.context.db
			.select()
			.from(this.table as any)
			.as(alias)
		this.getTableEntity = () => {
			return subquery
		}
	}

	jsonbSelect<TProp extends AnyColumn, TResult>(navProperty: TProp, selector: (value: TProp['_']['data']) => TResult): SQL<TResult> {
		return jsonbSelect(navProperty, selector)
	}

	sqlDateUnwrap(builder: (aliases: this) => AnyColumn): SQL<Date> {
		return builder(this) as any
	}

	subscribeNavigation(callbackFn: (args: { navigation: DbQueryRelation }) => void) {
		this._navigationCb = callbackFn

		for (const navPropKey of this.constructor.prototype.$navProps || []) {
			const navProp = this.getNavigationProperty(navPropKey, false)
			if (navProp != null && navProp.subscribeNavigation != null) {
				navProp.subscribeNavigation(callbackFn)
			}
		}
	}

	unsubscribeNavigation() {
		this._navigationCb = null as any

		for (const navPropKey of this.constructor.prototype.$navProps || []) {
			const navProp = this.getNavigationProperty(navPropKey, false)
			if (navProp != null && navProp.unsubscribeNavigation != null) {
				navProp.unsubscribeNavigation()
			}
		}
	}

	private getNavigationProperty(key: string, createIfMissing?: boolean, entityClass?: new (context: DbContext) => TEntity) {
		let entity: DbEntity<any, any> = null as any
		if ((this as any)['_' + key] != null) {
			entity = (this as any)['_' + key].deref()
		}

		if (entity == null && createIfMissing && entityClass != null) {
			entity = new entityClass(this.context) as any
			entity.changeTableToSubquery(key + entityClass.name);
			(this as any)['_' + key] = new WeakRef(entity);
		}

		return entity;
	}

	/** @internal */
	get table(): TTable {
		return this.getTableEntity()
	}

	protected abstract getTableEntity(): TTable
}
