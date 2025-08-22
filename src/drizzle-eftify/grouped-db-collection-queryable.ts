import { SQL, SelectedFields, ValueOrArray, sql } from 'drizzle-orm'
import { AnyPgColumn } from 'drizzle-orm/pg-core'
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { DbCollectionQueryable } from './queryable/db-collection-queryable'

export class GroupedDbCollectionQueryable<TOriginalQuery, TBaseQuery, TGroupingKey extends SelectedFields<any, any>> {
    private _db: PostgresJsDatabase<any>
    private _level: number
    private _subquery: any
    private _groupingKey: TGroupingKey

    constructor(db: PostgresJsDatabase<any>, baseQuery: TBaseQuery, originalQuery: TOriginalQuery, level: number, groupingKey: TGroupingKey, subquery: any) {
        this._db = db
        this._level = level
        this._subquery = subquery
        this._groupingKey = groupingKey
    }

    select<TResult extends SelectedFields<any, any>>(selector: (value: GroupedDbItem<typeof this._groupingKey['_']['selectedFields'], TOriginalQuery>) => TResult) {
        const columns = selector(new GroupedDbItem(this._groupingKey, this._level, this._subquery))

        let select = this._db.select(columns).from(this._subquery)
        const groupArr: any[] = []

        const groupingFields = this._groupingKey
        for (const fieldName in groupingFields) {
            groupArr.push(groupingFields[fieldName])
        }

        select = select.groupBy(groupArr as any) as any
        return new DbCollectionQueryable(this._db, select, this._level + 1)
    }
}

export class GroupedDbItem<TGroupingKey extends SelectedFields<any, any>, TOriginalQuery> {
    private _groupingKey: TGroupingKey
    private _level: number
    private _subquery: any
    private _counter: number = 0

    constructor(groupingKey: TGroupingKey, level: number, subquery: any) {
        this._groupingKey = groupingKey
        this._subquery = subquery
        this._level = level
    }

    count(): SQL<number> {
        return sql`count(${this.getFirstField()})`.as(`cnt${this._level}${this._counter++}`) as any
    }

    sum(builder: (aliases: TOriginalQuery) => ValueOrArray<AnyPgColumn | SQL | SQL.Aliased>): SQL<number> {
        return sql<number>`sum(${builder(this._subquery)})`.as(`sum${this._level}${this._counter++}`) as any
    }

    min(builder: (aliases: TOriginalQuery) => ValueOrArray<AnyPgColumn | SQL | SQL.Aliased>): SQL<number> {
        return sql<number>`min(${builder(this._subquery)})`.as(`min${this._level}${this._counter++}`) as any
    }

    get key(): TGroupingKey {
        return this._groupingKey
    }

    private getFirstField() {
        const fields = this._groupingKey
        return fields[Object.keys(fields)[0]]
    }
}
