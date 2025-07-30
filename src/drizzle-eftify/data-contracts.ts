import { SQL } from "drizzle-orm";

export interface EftifyCollectionJoinDeclaration {
    columnName: string
    isCollectionDeclaration: boolean,
    selectedColumns: any,
    sql: SQL,
    id: string,
}