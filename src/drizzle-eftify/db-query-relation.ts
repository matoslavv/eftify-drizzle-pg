import type { NormalizedRelation, SQL } from 'drizzle-orm'
import type { DbEntity } from './db-entity'

export interface DbQueryRelation {
	callingEntity: DbEntity<any, any>
	childEntity: DbEntity<any, any>
	uniqueKey: string
	relation: DbQueryRelationRecord
	formatColumns?: { fieldName: string, selection: any },
	joinDeclaration?: { sql: SQL, isLateral: boolean }
}

export interface DbQueryRelationBuildSqlArgs {
	callingEntity: DbEntity<any, any>
	childEntity: DbEntity<any, any>
	keyPairs: string[][]
}

export interface DbQueryRelationRecord {
	normalizedRelation: NormalizedRelation
	mandatory: boolean
	customRelationDefinition?: {
		buildJoinSql: (args: DbQueryRelationBuildSqlArgs) => SQL
	}
}