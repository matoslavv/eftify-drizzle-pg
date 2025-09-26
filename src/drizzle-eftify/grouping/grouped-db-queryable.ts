import { SelectedFields } from 'drizzle-orm'
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { DbQueryable } from '../queryable/db-queryable'
import GroupedDbItem from './grouped-db-item'

export class GroupedDbQueryable<TOriginalQuery, TBaseQuery, TGroupingKey extends SelectedFields<any, any>> {
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
		type SelectedType = typeof select._.selectedFields;
		return new DbQueryable<SelectedType>(this._db, select, this._level + 1);
	}
}


