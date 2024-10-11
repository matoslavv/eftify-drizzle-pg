import { NormalizedRelation, SQL } from 'drizzle-orm'
import { DbEntity } from './db-entity'

export interface DbQueryRelation {
	callingEntity: DbEntity<any, any>
	childEntity: DbEntity<any, any>
	uniqueKey: string
	relation: DbQueryRelationRecord
	joinDeclaration?: { sql: SQL, isLateral: boolean }
}

export interface DbQueryRelationRecord {
	normalizedRelation: NormalizedRelation
	mandatory: boolean
}