import { SQL } from "drizzle-orm";

export interface EftifyCollectionJoinDeclaration {
    columnName: string
    isCollectionDeclaration: boolean,
    mapFromDriverDefinition: {
        selectedColumns: any,
        childSelections: any
    }
    sql: SQL,
    id: string,
}