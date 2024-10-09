import { Column, DrizzleConfig, ExtractTableRelationsFromSchema, NormalizedRelation, normalizeRelation, One, Relation, Table } from "drizzle-orm";
import { AnyPgTable, PgTransactionConfig } from "drizzle-orm/pg-core";
import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { DbSet } from "./drizzle-eftify/db-set";
import { DbEntity } from "./drizzle-eftify/db-entity";
import { DbContext } from "./drizzle-eftify/db-context";
import { DbCollection } from "./drizzle-eftify/db-collection";
import { DbQueryRelationRecord } from "./drizzle-eftify/db-query-relation";


type RelationBuilder<TSchemaFull extends Record<string, unknown>, TRelations extends Record<string, Relation>> = {
    [P in keyof TRelations]: P extends keyof TSchemaFull
    ? TRelations[P] extends One<any> ? DbEntityType<TSchemaFull, P> & RelationalType<TSchemaFull, P> : DbCollection<DbEntityType<TSchemaFull, P> & RelationalType<TSchemaFull, P>>
    : never;
};

interface TableRelationalConfigSimple {
    columns?: Record<string, Column>;
    relations?: Record<string, Relation>;
}

type RelationalEntity<
    TFullSchema extends Record<string, unknown>,
    TSchema extends TableRelationalConfigSimple
> = RelationBuilder<TFullSchema, TSchema['relations']> & TSchema['columns'];


type ExtractTablesOnly<TSchema extends Record<string, unknown>> = {
    [K in keyof TSchema as TSchema[K] extends Table ? K : never]: TSchema[K] extends Table ? TSchema[K] & {
        columns: TSchema[K]['_']['columns'];
        relations: ExtractTableRelationsFromSchema<TSchema, TSchema[K]['_']['name']> extends never
        ? {}  // Fallback to empty object if relations is never
        : ExtractTableRelationsFromSchema<TSchema, TSchema[K]['_']['name']>;
    } : never;
};

type RelationalType<TSchema, K extends keyof TSchema> = TSchema[K] extends TableRelationalConfigSimple
    ? RelationalEntity<TSchema extends Record<string, unknown> ? TSchema : never, TSchema[K]>
    : never;

type DbEntityType<TSchema, K extends keyof TSchema> = DbEntity<
    RelationalType<TSchema, K>,
    TSchema[K] extends AnyPgTable ? TSchema[K] : never
>;

interface TransactionWrapper {
    rollback: () => Promise<void>
}

class DbContextImpl implements DbContext {
    private _db: PostgresJsDatabase<any>

    constructor(db: PostgresJsDatabase<any>) {
        this._db = db
    }

    transaction<T>(transaction: (tx: this & TransactionWrapper) => Promise<T>, config?: PgTransactionConfig): Promise<T> {
        return this.db.transaction(async (tx) => {
            (this as any as TransactionWrapper).rollback = async () => await tx.rollback()
            const oldDb = this._db
            this._db = tx
            let retVal: Awaited<T>

            try {
                retVal = await transaction(this as any)
                delete (this as any as TransactionWrapper).rollback
                this._db = oldDb
            } catch (errCaught) {
                delete (this as any as TransactionWrapper).rollback
                this._db = oldDb
                throw errCaught
            }

            return retVal
        }, config) as any
    }

    get db(): PostgresJsDatabase<any> {
        return this._db
    }
}

export const drizzleEftify = <TSchemaFull extends Record<string, unknown> = Record<string, never>, TSchema = ExtractTablesOnly<TSchemaFull>>(pgClient: any, config?: DrizzleConfig<TSchemaFull>): PostgresJsDatabase<TSchemaFull> & {
    eftify: {
        [K in keyof TSchema]: DbSet<
            RelationalType<TSchema, K>,
            TSchema[K] extends AnyPgTable ? TSchema[K] : never,
            DbEntityType<TSchema, K> & RelationalType<TSchema, K>
        >;
    } & DbContext
} => {
    const drizzleDb: any = drizzle(pgClient, config);
    drizzleDb.eftify = drizzleEftifyCreateRelations(drizzleDb);
    return drizzleDb;
}


const drizzleEftifyCreateRelations = <TSchemaFull extends Record<string, unknown> = Record<string, never>, TSchema = ExtractTablesOnly<TSchemaFull>>(drizzleDb: PostgresJsDatabase<TSchemaFull>): {
    [K in keyof TSchema]: DbSet<
        RelationalType<TSchema, K>,
        TSchema[K] extends AnyPgTable ? TSchema[K] : never,
        DbEntityType<TSchema, K> & RelationalType<TSchema, K>
    >;
} & DbContext => {
    const schema = drizzleDb['_'].schema;
    const fullSchema = drizzleDb['_'].fullSchema;
    const tableNamesMap = drizzleDb['_'].tableNamesMap;
    const entityCache: { [index: string]: DbEntity<any, any> } = {};
    const retObj: any = new DbContextImpl(drizzleDb);
    const dbTsNameMap: { [index: string]: string } = {};

    for (const [tableName] of Object.entries(schema)) {
        const table = (schema as any)[tableName];
        const schemaTable = fullSchema[tableName];
        if (schemaTable == null) {
            throw 'Base table not extracted from the schema';
        }

        //Define class extending the DbEntity
        class InnerEntity extends DbEntity<any, any> {
            protected getTableEntity() {
                return schemaTable;
            }
        }

        //Put in cache
        entityCache[tableName] = InnerEntity as any;
        dbTsNameMap[table.dbName] = table.tsName;
    }

    for (const [tableName] of Object.entries(schema)) {
        const table = (schema as any)[tableName];
        const relations = table.relations;

        const columns = table.columns;
        if (columns == null) {
            throw 'Columns not set on the table';
        }

        const schemaTable = fullSchema[tableName];
        if (schemaTable == null) {
            throw 'Base table not extracted from the schema';
        }

        const entityClass = entityCache[tableName];

        //Populate it with table columns
        for (const [colName] of Object.entries(columns)) {
            Object.defineProperty((entityClass as any).prototype, colName, {
                get() {
                    return this.table[colName];
                },
                configurable: true,
                enumerable: true,
            });
        }

        //Build relations
        for (const [relName] of Object.entries(relations)) {
            const relation: NormalizedRelation = normalizeRelation(schema, tableNamesMap, relations[relName]);
            let tableName = relations[relName].referencedTableName;
            if (dbTsNameMap[tableName] != null) {
                tableName = dbTsNameMap[tableName];
            }

            const navClass = entityCache[tableName];
            if (navClass == null) {
                throw 'Entity class not found in the cache!';
            }

            const isOneToOne = (relations[relName] as any).constructor.name == 'One';
            const relationItem: DbQueryRelationRecord = {
                mandatory: (relations[relName] as One).isNullable != true,
                normalizedRelation: relation
            };

            if (isOneToOne) {
                Object.defineProperty((entityClass as any).prototype, relName, {
                    get() {
                        const retVal: any = this.getNavigationProperty(relName, true, navClass)
                        if (this._navigationCb != null) {
                            retVal.subscribeNavigation(this._navigationCb)

                            this._navigationCb({
                                navigation: {
                                    callingEntity: this,
                                    childEntity: retVal,
                                    uniqueKey: relName + tableName,
                                    relation: relationItem
                                }
                            })
                        }

                        return retVal
                    },
                    configurable: true,
                    enumerable: true,
                });
            } else {
                Object.defineProperty((entityClass as any).prototype, relName, {
                    get() {
                        let navProp: DbCollection<any> = null as any
                        if ((this as any)['_' + relName] != null) {
                            navProp = (this as any)['_' + relName].deref()
                        }

                        if (navProp == null) {
                            navProp = new DbCollection(this.context, this, relationItem, new (navClass as any)(this.context));
                            (this as any)['_' + relName] = new WeakRef(navProp);
                        }

                        return navProp
                    },
                    configurable: true,
                    enumerable: true,
                });
            }
        }

        Object.defineProperty(retObj, tableName, {
            get: () => {
                const context = new DbContextImpl(drizzleDb);
                const ctor: any = entityCache[tableName];
                return new DbSet(context, new ctor(context, table));
            },
        });
    }

    return retObj;
}