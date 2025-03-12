import { and, AnyColumn, AnyTable, entityKind, eq, Equal, Many, One, Relation, RelationConfig, relations, Relations, sql, Table } from "drizzle-orm";
import { DbQueryRelationBuildSqlArgs } from "../db-query-relation";

declare function createTableRelationsHelpersEftify<TTableName extends string>(sourceTable: AnyTable<{
    name: TTableName;
}>): {
    one: <TForeignTable extends Table, TColumns extends [AnyColumn<{
        tableName: TTableName;
    }>, ...AnyColumn<{
        tableName: TTableName;
    }>[]]>(table: TForeignTable, config?: RelationConfig<TTableName, TForeignTable["_"]["name"], TColumns> | undefined) => One<TForeignTable["_"]["name"], Equal<TColumns[number]["_"]["notNull"], true>>;
    many: <TForeignTable extends Table>(referencedTable: TForeignTable, config?: {
        relationName: string;
    }) => Many<TForeignTable["_"]["name"]>;
    manyFromKeyArray: <TForeignTable extends Table, TColumns extends [AnyColumn<{
        tableName: TTableName;
    }>, ...AnyColumn<{
        tableName: TTableName;
    }>[]]>(table: TForeignTable, config?: RelationConfig<TTableName, TForeignTable["_"]["name"], TColumns> & { mandatory?: boolean } | undefined) => Many<TForeignTable["_"]["name"]>;
};
export type EftifyTableRelationsHelpers<TTableName extends string> = ReturnType<typeof createTableRelationsHelpersEftify<TTableName>>;

class ManyFromKeyArray<
    TTableName extends string = string,
    TIsNullable extends boolean = boolean,
> extends Relation<TTableName> {
    static override readonly [entityKind]: string = 'ManyFromKeyArray';
    declare protected $relationBrand: 'ManyFromKeyArray';

    type = 'many';
    _custom = true;

    constructor(
        sourceTable: Table,
        referencedTable: AnyTable<{ name: TTableName }>,
        readonly config:
            | RelationConfig<
                TTableName,
                string,
                AnyColumn<{ tableName: TTableName }>[]
            >
            | undefined,
        readonly isNullable: TIsNullable,
        readonly buildJoinSql: any,
        readonly normalizedRelation: any
    ) {
        super(sourceTable, referencedTable, config?.relationName);
    }

    static createFromConfig(helpers: any, table: Table, config: any) {
        const builtObj: any = helpers.one(table, config);

        return new ManyFromKeyArray(
            builtObj.sourceTable,
            builtObj.referencedTable,
            config,
            config.mandatory != true,
            (args: DbQueryRelationBuildSqlArgs) => {
                return and(
                    ...args.keyPairs.map((field, i) => {
                        const childCol = args.childEntity.table[field[1]];
                        const parentCol = args.callingEntity.table[field[0]];

                        if (childCol.columnType == 'PgArray') {
                            return eq(parentCol, sql`ANY(${childCol})`)
                        } else {
                            return eq(childCol, sql`ANY(${parentCol})`)
                        }
                    })
                );
            },
            {
                fields: config.fields,
                references: config.references
            }
        )
    }

    withFieldName(fieldName: string): ManyFromKeyArray<TTableName> {
        const relation = new ManyFromKeyArray(
            this.sourceTable,
            this.referencedTable,
            this.config,
            this.isNullable,
            this.buildJoinSql,
            this.normalizedRelation
        );
        relation.fieldName = fieldName;
        return relation;
    }
}



export function eftifyRelations<TTableName extends string, TRelations extends Record<string, Relation<any>>>(table: AnyTable<{
    name: TTableName;
}>, relationConfig: (helpers: EftifyTableRelationsHelpers<TTableName> & { cust: string }) => TRelations): Relations<TTableName, TRelations> {
    return (relations as typeof eftifyRelations)(table, (helpers) => {
        (helpers as any).manyFromKeyArray = (table: any, config: any) => {
            return ManyFromKeyArray.createFromConfig(helpers, table, config);
        };

        return relationConfig(helpers);
    });
}