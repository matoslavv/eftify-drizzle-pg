import { PgTransactionConfig } from 'drizzle-orm/pg-core'
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

interface TransactionWrapper {
	rollback: () => Promise<void>
}

export interface DbContext {
	transaction<T>(transaction: (tx: this & TransactionWrapper) => Promise<T>, config?: PgTransactionConfig): Promise<T>
	get db(): PostgresJsDatabase<any>
}