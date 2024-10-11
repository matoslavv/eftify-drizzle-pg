import { SQL } from "drizzle-orm";

export interface EftifyCollectionJoinDeclaration {
    columnName: string
    isCollectionDeclaration: boolean,
    sql: SQL,
    id: string,
}