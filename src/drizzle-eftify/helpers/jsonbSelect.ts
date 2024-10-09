import { AnyColumn, SQL, sql } from 'drizzle-orm'

export function jsonbSelect<TProp extends AnyColumn, TResult>(navProperty: TProp, selector: (value: TProp['_']['data']) => TResult): SQL<TResult> {
	const propName = selector.toString().split('.').pop() as string;
	const secondPart = `::jsonb->>'${propName}'`

	return sql.join([sql`(${navProperty} #>> '{}')`, sql.raw(secondPart)]).as(propName) as any
}

export function coalesce<T>(col1: AnyColumn, col2: AnyColumn) {
	return sql<T>`coalesce(${col1}, ${col2})`
}
