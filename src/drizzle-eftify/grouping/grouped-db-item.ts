import { SQL, SelectedFields, ValueOrArray, sql } from 'drizzle-orm'
import { AnyPgColumn } from 'drizzle-orm/pg-core'


export default class GroupedDbItem<TGroupingKey extends SelectedFields<any, any>, TOriginalQuery> {
    private _groupingKey: TGroupingKey
    private _level: number
    private _subquery: any
    private _counter: number = 0

    constructor(groupingKey: TGroupingKey, level: number, subquery: any) {
        this._groupingKey = groupingKey
        this._subquery = subquery
        this._level = level
    }

    count(colAlias?: string): SQL.Aliased<number> {
        return sql`count(${this.getFirstField()})`.as(colAlias ?? `cnt${this._level}${this._counter++}`) as any
    }

    sum(builder: (aliases: TOriginalQuery) => ValueOrArray<AnyPgColumn | SQL | SQL.Aliased>, colAlias?: string): SQL.Aliased<number> {
        return sql<number>`sum(${builder(this._subquery)})`.as(colAlias ?? `sum${this._level}${this._counter++}`) as any
    }

    min(builder: (aliases: TOriginalQuery) => ValueOrArray<AnyPgColumn | SQL | SQL.Aliased>, colAlias?: string): SQL.Aliased<number> {
        return sql<number>`min(${builder(this._subquery)})`.as(colAlias ?? `min${this._level}${this._counter++}`) as any
    }

    get key(): TGroupingKey {
        return this._groupingKey
    }

    private getFirstField() {
        const fields = this._groupingKey
        return fields[Object.keys(fields)[0]]
    }
}