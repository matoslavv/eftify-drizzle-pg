import {
	Column,
	InferInsertModel,
	InferModelFromColumns,
	InferSelectModel,
	SQL,
	SelectedFields,
	Table,
	ValueOrArray,
	WithSubquery,
	and,
	sql
} from 'drizzle-orm'
import { AnyPgColumn, AnyPgTable, IndexColumn } from 'drizzle-orm/pg-core'
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { DbContext } from './db-context'
import { DbEntity } from './db-entity'
import { DbQueryCommon } from './db-query-common'
import { DbQueryRelation } from './db-query-relation'
import { DbQueryable } from './queryable/db-queryable'
import { PgColumn } from 'drizzle-orm/pg-core'
import { DbCte } from './cte/db-cte-builder'

export type EftifyUpdateModel<TTable extends Table, TConfig extends {
	dbColumnNames: boolean;
	override?: boolean;
} = {
	dbColumnNames: false;
	override: false;
}> = Partial<InferModelFromColumns<TTable['_']['columns'], 'select', TConfig>>;

export type EftifyInsertModel<TTable extends Table> = InferInsertModel<TTable> & EftifyUpdateModel<TTable>;

export class DbSet<TDataModel extends any, TTable extends AnyPgTable, TEntity extends DbEntity<TDataModel, TTable>> {
	private _entity: TEntity
	private _context: WeakRef<DbContext>
	private _pendingWhere: any
	private _pendingOrderBy: any
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


	orderBy(builder: (aliases: TEntity) => ValueOrArray<AnyPgColumn | SQL | SQL.Aliased>): this {
		if (this._pendingOrderBy != null) {
			throw 'Order by is already specified, only one orderBy vlause supported per DbSet. If you need further sorting, considering making a projection by using .select(p => ...) and making the sort afterwards'
		}

		this._entity.subscribeNavigation((args) => {
			if (this._pendingRelations == null) {
				this._pendingRelations = []
			}

			this._pendingRelations.push(args.navigation)
		})

		let orderByStatement: any;
		if (Array.isArray(builder)) {
			const unwrapper = (a: any): any => {
				return a;
			}

			// @ts-ignore
			orderByStatement = unwrapper(...(builder as any))
		} else {
			orderByStatement = builder(this._entity);
		}


		this._pendingOrderBy = orderByStatement;
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
		DbQueryCommon.ensureColumnAliased(columns, false, relationArr)
		this._entity.unsubscribeNavigation()
		let select = this.createQuery(columns)

		try {
			select = DbQueryCommon.buildRelations(select, relationArr)
		} catch (error) {
			//Might have been build in previous step
		}

		DbQueryCommon.setFormatColumnsOnBaseQuery(this, select, columns);
		return new DbQueryable(db, select, 1)
	}

	/**
	 * Add CTEs to queries on this DbSet. CTEs can be referenced in subsequent operations.
	 * @param ctes Array of CTE definitions from DbCteBuilder
	 */
	with(...ctes: WithSubquery<any, any>[]): this {
		// Store CTEs to be applied to queries
		(this as any)._pendingCtes = ctes
		return this
	}

	/**
	 * Perform a left join with a DbCte (strongly typed), returning a combined queryable.
	 * This overload preserves the full type information from DbCte.
	 */
	leftJoin<TCteSelection extends SelectedFields<any, any>, TResult extends SelectedFields<any, any>>(
		dbCte: DbCte<TCteSelection>,
		on: (table: TEntity, cte: TCteSelection) => SQL | undefined,
		selector: (table: TEntity, cte: TCteSelection) => TResult
	): DbQueryable<TResult>

	/**
	 * Perform a left join with a CTE, returning a combined queryable.
	 */
	leftJoin<TCteSelection extends SelectedFields<any, any>, TResult extends SelectedFields<any, any>>(
		cte: WithSubquery<any, any>,
		on: (table: TEntity, cte: TCteSelection) => SQL | undefined,
		selector: (table: TEntity, cte: TCteSelection) => TResult
	): DbQueryable<TResult>

	/**
	 * Perform a left join with a DbQueryable, returning a combined queryable.
	 */
	leftJoin<TCteSelection extends SelectedFields<any, any>, TResult extends SelectedFields<any, any>>(
		queryable: DbQueryable<TCteSelection>,
		on: (table: TEntity, cte: TCteSelection) => SQL | undefined,
		selector: (table: TEntity, cte: TCteSelection) => TResult
	): DbQueryable<TResult>

	/**
	 * Perform a left join with a DbSet, returning a combined queryable.
	 * This preserves the strong typing of the DbSet entity.
	 *
	 * @example
	 * const activePosts = dbContext.posts.where(p => eq(p.status, 'active'));
	 * const result = await dbContext.users
	 *   .leftJoin(
	 *     activePosts,
	 *     (user, post) => eq(user.id, post.authorId),  // post is fully typed!
	 *     (user, post) => ({ userId: user.id, postId: post.id })
	 *   )
	 *   .toList();
	 */
	leftJoin<TJoinEntity extends DbEntity<any, any>, TResult extends SelectedFields<any, any>>(
		dbSet: DbSet<any, any, TJoinEntity>,
		on: (table: TEntity, joinEntity: TJoinEntity) => SQL | undefined,
		selector: (table: TEntity, joinEntity: TJoinEntity) => TResult
	): DbQueryable<TResult>

	leftJoin<TCteSelection extends SelectedFields<any, any>, TResult extends SelectedFields<any, any>>(
		cteOrQueryableOrSet: DbCte<TCteSelection> | WithSubquery<any, any> | DbQueryable<TCteSelection> | DbSet<any, any, any>,
		on: (table: TEntity, cte: TCteSelection) => SQL | undefined,
		selector: (table: TEntity, cte: TCteSelection) => TResult
	): DbQueryable<TResult> {
		return this._performJoin('left', cteOrQueryableOrSet, on, selector)
	}

	/**
	 * Perform an inner join with a DbCte (strongly typed), returning a combined queryable.
	 * This overload preserves the full type information from DbCte.
	 */
	innerJoin<TCteSelection extends SelectedFields<any, any>, TResult extends SelectedFields<any, any>>(
		dbCte: DbCte<TCteSelection>,
		on: (table: TEntity, cte: TCteSelection) => SQL | undefined,
		selector: (table: TEntity, cte: TCteSelection) => TResult
	): DbQueryable<TResult>

	/**
	 * Perform an inner join with a CTE, returning a combined queryable.
	 */
	innerJoin<TCteSelection extends SelectedFields<any, any>, TResult extends SelectedFields<any, any>>(
		cte: WithSubquery<any, any>,
		on: (table: TEntity, cte: TCteSelection) => SQL | undefined,
		selector: (table: TEntity, cte: TCteSelection) => TResult
	): DbQueryable<TResult>

	/**
	 * Perform an inner join with a DbQueryable, returning a combined queryable.
	 */
	innerJoin<TCteSelection extends SelectedFields<any, any>, TResult extends SelectedFields<any, any>>(
		queryable: DbQueryable<TCteSelection>,
		on: (table: TEntity, cte: TCteSelection) => SQL | undefined,
		selector: (table: TEntity, cte: TCteSelection) => TResult
	): DbQueryable<TResult>

	/**
	 * Perform an inner join with a DbSet, returning a combined queryable.
	 * This preserves the strong typing of the DbSet entity.
	 *
	 * @example
	 * const activePosts = dbContext.posts.where(p => eq(p.status, 'active'));
	 * const result = await dbContext.users
	 *   .innerJoin(
	 *     activePosts,
	 *     (user, post) => eq(user.id, post.authorId),  // post is fully typed!
	 *     (user, post) => ({ userId: user.id, postId: post.id })
	 *   )
	 *   .toList();
	 */
	innerJoin<TJoinEntity extends DbEntity<any, any>, TResult extends SelectedFields<any, any>>(
		dbSet: DbSet<any, any, TJoinEntity>,
		on: (table: TEntity, joinEntity: TJoinEntity) => SQL | undefined,
		selector: (table: TEntity, joinEntity: TJoinEntity) => TResult
	): DbQueryable<TResult>

	innerJoin<TCteSelection extends SelectedFields<any, any>, TResult extends SelectedFields<any, any>>(
		cteOrQueryableOrSet: DbCte<TCteSelection> | WithSubquery<any, any> | DbQueryable<TCteSelection> | DbSet<any, any, any>,
		on: (table: TEntity, cte: TCteSelection) => SQL | undefined,
		selector: (table: TEntity, cte: TCteSelection) => TResult
	): DbQueryable<TResult> {
		return this._performJoin('inner', cteOrQueryableOrSet, on, selector)
	}

	/**
	 * Shared implementation for both left and inner joins
	 */
	private _performJoin<TCteSelection extends SelectedFields<any, any>, TResult extends SelectedFields<any, any>>(
		joinType: 'left' | 'inner',
		cteOrQueryableOrSet: DbCte<TCteSelection> | WithSubquery<any, any> | DbQueryable<TCteSelection> | DbSet<any, any, any>,
		on: (table: TEntity, cte: TCteSelection) => SQL | undefined,
		selector: (table: TEntity, cte: TCteSelection) => TResult
	): DbQueryable<TResult> {
		const db = this.db
		const pendingCtes = (this as any)._pendingCtes || []

		// Convert DbQueryable, DbSet, or DbCte to a CTE if needed
		let cte: WithSubquery<any, any>
		let additionalCtes: WithSubquery<any, any>[] = []

		if (cteOrQueryableOrSet instanceof DbCte) {
			// It's a DbCte - extract the underlying WithSubquery
			cte = cteOrQueryableOrSet.cte
		} else if (cteOrQueryableOrSet instanceof DbSet) {
			// It's a DbSet - convert it to a query first, then to a CTE
			// This preserves any where/orderBy conditions on the DbSet
			const dbSetQuery = (cteOrQueryableOrSet as any).createEmptyQuery()
			const queryableName = `dbset_${Date.now()}`
			cte = db.$with(queryableName).as(dbSetQuery)
			additionalCtes.push(cte)
		} else if (cteOrQueryableOrSet instanceof DbQueryable) {
			// It's a DbQueryable - convert it to a CTE
			const queryableName = `subquery_${Date.now()}`
			cte = db.$with(queryableName).as(cteOrQueryableOrSet.toDrizzleQuery())
			additionalCtes.push(cte)
		} else {
			// It's already a WithSubquery (CTE)
			cte = cteOrQueryableOrSet
		}

		// Apply CTEs at database level
		let dbWithCtes: any = db
		const allCtes = [...pendingCtes, ...additionalCtes]
		if (allCtes.length > 0) {
			dbWithCtes = db.with(...allCtes)
		}

		// Capture pending conditions before they're cleared
		const whereCondition = this._pendingWhere
		const orderByCondition = this._pendingOrderBy

		// Clear pending conditions
		this._pendingWhere = null
		this._pendingOrderBy = null

		// Track navigation properties (like user.userAddress.address)
		const relationArr: DbQueryRelation[] = []
		this._entity.subscribeNavigation((args) => {
			relationArr.push(args.navigation)
		})

		// Get the join condition
		const joinCondition = on(this._entity, cte as any)

		// Get the combined columns
		const columns = selector(this._entity, cte as any)

		// Unsubscribe from navigation tracking
		this._entity.unsubscribeNavigation()

		// Only flatten if the user passed nested proxy objects (not individual column selections)
		const needsFlattening = DbQueryCommon.needsFlattening(columns)
		const finalColumns = needsFlattening ? DbQueryCommon.flattenProxyStructure(columns) : columns
		DbQueryCommon.ensureColumnAliased(finalColumns, false, relationArr)

		// Build the complete query: select combined columns from table joined with CTE
		let finalQuery = dbWithCtes.select(finalColumns).from(this._entity.table as any)

		// Apply the join (left or inner based on joinType)
		if (joinType === 'left') {
			finalQuery = finalQuery.leftJoin(cte, joinCondition)
		} else {
			finalQuery = finalQuery.innerJoin(cte, joinCondition)
		}

		// Build navigation relations (joins for foreign keys)
		try {
			finalQuery = DbQueryCommon.buildRelations(finalQuery, relationArr)
		} catch (error) {
			// Might have been built in previous step
		}

		// Apply where condition if present
		if (whereCondition != null) {
			finalQuery = finalQuery.where(whereCondition)
		}

		// Apply orderBy if present
		if (orderByCondition != null) {
			finalQuery = finalQuery.orderBy(orderByCondition)
		}

		DbQueryCommon.setFormatColumnsOnBaseQuery(this, finalQuery, finalColumns)
		return new DbQueryable(db, finalQuery, 1, allCtes)
	}

	/**
	 * Perform a left join with a CTE or table, then select columns
	 * @param cte The CTE to join
	 * @param on The join condition
	 * @param selector The columns to select from both the table and CTE
	 * @deprecated Use leftJoin instead for better handling of ambiguous column names
	 */
	leftJoinSelect<TCteSelection extends SelectedFields<any, any>, TResult extends SelectedFields<any, any>>(
		cte: WithSubquery<any, any>,
		on: (table: TEntity, cte: TCteSelection) => SQL | undefined,
		selector: (table: TEntity, cte: TCteSelection) => TResult
	): DbQueryable<TResult> {
		return this.leftJoin(cte, on, selector)
	}

	async firstOrDefault(): Promise<InferSelectModel<TTable>> {
		const retVal = await this.createEmptyQuery().limit(1)
		return retVal[0] as any
	}

	async toList(): Promise<InferSelectModel<TTable>[]> {
		return (await this.createEmptyQuery()) as any
	}

	insert(value: EftifyInsertModel<TTable> | EftifyInsertModel<TTable>[]) {
		return this.db.insert(this._entity.table as any).values(value);
	}

	insertBulk(value: EftifyInsertModel<TTable> | EftifyInsertModel<TTable>[], insertConfig?: InsertConfig): ReturnType<this['insert']> {
		let baseBuilder: any = this.db.insert(this._entity.table as any);
		if (insertConfig?.overridingSystemValue) {
			baseBuilder = baseBuilder.overridingSystemValue();
		}

		if (Array.isArray(value) && (value as any[]).length > (insertConfig?.chunkSize ?? 700)) {
			let chunkSize = insertConfig?.chunkSize;
			if (chunkSize == null) {
				const POSTGRES_MAX_ROWS_SINGLE_BATCH = 65534; // Most common limit
				const columnCount = Object.keys(value[0])?.length;
				const maxRowsPerBatch = Math.floor(POSTGRES_MAX_ROWS_SINGLE_BATCH / columnCount);
				chunkSize = Math.floor(maxRowsPerBatch * 0.6); // Takes only 60% of the max rows to avoid hitting the limit
			}

			baseBuilder = new InsertChunkWrapper(baseBuilder, value, chunkSize);
		} else {
			baseBuilder = baseBuilder.values(value);
		}

		return baseBuilder;
	}

	upsertBulk(values: EftifyInsertModel<TTable>[], config?: UpsertConfig) {
		const referenceItem = config?.referenceItem || values[0];
		const table = this.getUnderlyingEntity().table;
		const columns = (table as any)[(Table as any).Symbol.Columns];
		let columnFilter = config?.updateColumnFilter;
		if (columnFilter == null) {
			if (config?.updateColumns != null) {
				const colIds: string[] = [];
				for (let [name, field] of Object.entries(columns)) {
					if (config.updateColumns.includes(field as any)) {
						colIds.push(name);
					}
				}

				columnFilter = function (colId: string) { return colIds.includes(colId) };
			} else {
				columnFilter = function (colId: string) { return true; };
			}
		}

		let primaryKey = config?.primaryKey;
		if (primaryKey == null) {
			primaryKey = [];
			for (let [name, field] of Object.entries(columns)) {
				if ((field as PgColumn).primary) {
					primaryKey.push(field as PgColumn);
				}
			}
		}

		if (!Array.isArray(primaryKey)) {
			primaryKey = [primaryKey];
		}

		let overridingSystemValue = config?.overridingSystemValue;
		if (overridingSystemValue == null) {
			for (let [name, field] of Object.entries(referenceItem)) {
				const col = columns[name];
				if (col?.primary) {
					overridingSystemValue = true;
					break;
				}
			}
			Object.keys(referenceItem)
		}

		const primaryKeyNames = primaryKey.map(p => p.name);
		const insertConfig: InsertConfig = {
			chunkSize: config?.chunkSize,
			overridingSystemValue
		};

		return this.insertBulk(values, insertConfig).onConflictDoUpdate({
			target: primaryKey,
			set: Object.fromEntries(Object.keys(referenceItem)
				.filter(k => !primaryKeyNames.includes(k) && columnFilter(k))
				.map((k) => {
					const column = (columns as any)[k];
					return [
						k as any,
						sql`excluded.${sql.identifier(column.name)}`,
					];
				})),
		});
	}

	update(value: EftifyUpdateModel<TTable>) {
		let query = this.db.update(this._entity.table).set(value as any)
		if (this._pendingWhere != null) {
			query = query.where(this._pendingWhere) as any
		}

		if (this._pendingRelations?.length > 0) {
			query = DbQueryCommon.processRelationsForUpdate(query, this._pendingRelations, value);
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
		let select = this.db.select(columns).from(this._entity.table as any)
		if (this._pendingWhere != null) {
			select = select.where(this._pendingWhere) as any
			this._pendingWhere = null;
		}

		if (this._pendingOrderBy != null) {
			select = select.orderBy(this._pendingOrderBy) as any
			this._pendingOrderBy = null;
		}

		if (this._pendingRelations?.length > 0) {
			select = DbQueryCommon.buildRelations(select as any, this._pendingRelations) as any;
			this._pendingRelations = null as any;
		}

		return select
	}
}


interface InsertConfig {
	/**
	 * Size of insert chunk, if not provided, it will be auto-detected based on default max PG query parameters limit
	 */
	chunkSize?: number
	overridingSystemValue?: boolean
}

interface UpsertConfig {
	/**
	 * Size of insert chunk, if not provided, it will be auto-detected based on default max PG query parameters limit
	 */
	chunkSize?: number

	/**
	 * Primary key columns, these are columns where conflict is detected. If not specified, table's primary keys wil lbe taken into account
	 */
	primaryKey?: IndexColumn | IndexColumn[]

	/**
	 * Set as true when perforing upsert as a trick for bulk update. If not specified correct value will be auto-detected
	 */
	overridingSystemValue?: boolean

	targetWhere?: SQL;
	setWhere?: SQL;

	/**
	 * Reference item based on which columns are detected. If not specified, first value from the insert array is used instead
	 */
	referenceItem?: any

	/**
	 * List of columns that should be updated in case of conflict. If not specified All fields from the reference besides primaryKeys are updated. For advanced filtering you may use {@link UpsertConfig.updateColumnFilter}
	 */
	updateColumns?: Column[]

	/**
	 * Filter method to determine if column should be updated in case of conflict
	 */
	updateColumnFilter?: (colId: string) => boolean
}

interface IInsertChunkWrapper {
	returningConfig?: any
	onConflictDoNothingBound?: boolean
	onConflictDoNothingArgs?: any
	onConflictDoUpdateArgs?: any
	execute(): Promise<any>
}

class InsertChunkWrapper implements IInsertChunkWrapper {
	constructor(
		private builder: any,
		private valueArr: any[],
		private chunkSize: number
	) { }

	values() {
		return this;
	}

	returning(config: any) {
		(this as unknown as IInsertChunkWrapper).returningConfig = config;
		return this;
	}

	onConflictDoNothing(config: any) {
		(this as unknown as IInsertChunkWrapper).onConflictDoNothingBound = true;
		(this as unknown as IInsertChunkWrapper).onConflictDoNothingArgs = config;
		return this;
	}

	onConflictDoUpdate(config: any) {
		(this as unknown as IInsertChunkWrapper).onConflictDoUpdateArgs = config;
		return this;
	}

	async execute() {
		const results = [];

		for (let i = 0; i < this.valueArr.length; i += this.chunkSize) {
			const chunk = this.valueArr.slice(i, i + this.chunkSize);
			let query = this.builder.values(chunk);

			if ((this as unknown as IInsertChunkWrapper).returningConfig) {
				query = query.returning((this as unknown as IInsertChunkWrapper).returningConfig);
			}

			if ((this as unknown as IInsertChunkWrapper).onConflictDoNothingBound) {
				query = query.onConflictDoNothing((this as unknown as IInsertChunkWrapper).onConflictDoNothingArgs);
			}

			if ((this as unknown as IInsertChunkWrapper).onConflictDoUpdateArgs) {
				query = query.onConflictDoUpdate((this as unknown as IInsertChunkWrapper).onConflictDoUpdateArgs);
			}

			results.push(...(await query));
		}

		return results;
	}

	then(onfulfilled: any, onrejected?: any) {
		return this.execute().then(onfulfilled, onrejected);
	}
}
