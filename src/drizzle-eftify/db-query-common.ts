import { AnyColumn, Column, One, OneOrMany, SQL, Table, aliasedTableColumn, and, eq, is, sql } from 'drizzle-orm'
import { DbEntity } from './db-entity'
import { DbQueryRelation } from './db-query-relation'
import DbEftifyConfig from './db-eftify-config';
import { EftifyCollectionJoinDeclaration } from './data-contracts';

export class DbQueryCommon {
	static ensureColumnAliased(fields: any, fixColumnNames: boolean, relationArr: DbQueryRelation[], opData?: { count: number; names: { [index: string]: boolean } }) {
		opData = opData || { count: 0, names: {} }



		for (let [name, field] of Object.entries(fields)) {
			if ((field as EftifyCollectionJoinDeclaration).isCollectionDeclaration) {
				fields[name] = (field as EftifyCollectionJoinDeclaration).sql.as((field as EftifyCollectionJoinDeclaration).columnName);
				field = fields[name];
			}

			if (typeof name !== 'string' || is(field, SQL) || is(field, SQL.Aliased)) {
				continue
			}

			if (is(field, Column)) {
				if (field.name != name && fixColumnNames) {
					if (!DbEftifyConfig.pgForAliasedColumnsReturnDateAsUTC) {
						fields[name] = sql`${field}`.as(`${name}`)
					} else {
						if (field.getSQLType() != 'timestamp with time zone') {
							fields[name] = sql`${field}`.as(`${name}`)
						} else {
							fields[name] =
								sql`to_char(${field} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as(
									`${name}`
								)
						}
					}
				}
			} else if (field instanceof DbEntity) {
				const objBuilder: any = {}
				for (const fieldName of field.constructor.prototype.$columns) {
					objBuilder[fieldName] = (field as any)[fieldName]
				}

				DbQueryCommon.ensureColumnAliased(objBuilder, fixColumnNames, relationArr, opData)
				fields[name] = objBuilder
			} else if (is(field, Table)) {
				DbQueryCommon.ensureColumnAliased(
					(field as any)[(Table as any).Symbol.Columns],
					fixColumnNames,
					relationArr,
					opData
				)
			} else if (!field) {
				delete fields[name]
			} else {
				DbQueryCommon.ensureColumnAliased(field, fixColumnNames, relationArr, opData)
			}
		}
	}

	static createJoinOn(relationItem: DbQueryRelation) {
		const normalizedRelation = relationItem.relation.normalizedRelation;
		if ((relationItem.relation as any)._keyPairs == null) {
			(relationItem.relation as any)._keyPairs = [];
			const getChildNames = (table: any): string[] => {
				const isSubquery = (table['_'] || {})['sql'] != null;
				if (isSubquery) {
					return Object.keys(table['_']['selectedFields']);
				} else {
					return Object.keys(table);
				}
			};

			const findColumnFieldName = (table: any, columnSet: string[], field: AnyColumn) => {
				for (const colName of columnSet) {
					const col: AnyColumn = table[colName];
					if (col.uniqueName == field.uniqueName) {
						return colName;
					}
				}
			}

			let parentColNames: string[] = getChildNames(relationItem.callingEntity.table);
			let childColNames: string[] = getChildNames(relationItem.childEntity.table);

			for (let i = 0, len = normalizedRelation.fields.length; i < len; i++) {
				const field = normalizedRelation.fields[i];
				const fieldFromName = findColumnFieldName(relationItem.callingEntity.table, parentColNames, field);
				const referencedCol = normalizedRelation.references[i];
				const fieldToName = findColumnFieldName(relationItem.childEntity.table, childColNames, referencedCol);

				if (fieldFromName == null || fieldToName == null) {
					throw 'Fields mapping not found';
				}

				(relationItem.relation as any)._keyPairs.push([fieldFromName, fieldToName])
			}
		}

		const keyPairs: string[][] = (relationItem.relation as any)._keyPairs;
		const joinOn = and(
			...keyPairs.map((field, i) =>
				eq(
					relationItem.childEntity.table[field[1]],
					relationItem.callingEntity.table[field[0]]
				)
			),
		);

		return joinOn;
	}

	static buildRelations<T>(select: T, relationArr: DbQueryRelation[]) {
		if (relationArr.length == 0) {
			return select
		}

		const handledKeys: { [index: string]: boolean } = {}
		for (const relationItem of relationArr) {
			if (handledKeys[relationItem.uniqueKey]) {
				continue
			} else {
				handledKeys[relationItem.uniqueKey] = true
			}

			try {
				if (relationItem.relation.mandatory) {
					select = (select as any).innerJoin(
						relationItem.childEntity.table,
						DbQueryCommon.createJoinOn(relationItem)
					) as any
				} else {
					select = (select as any).leftJoin(
						relationItem.childEntity.table,
						DbQueryCommon.createJoinOn(relationItem)
					) as any
				}
			} catch (error) {
				if (!((error as any)?.message?.indexOf('is already used in this query') > 0)) {
					throw error
				}
			}
		}

		return select
	}

	static traceExecutionStart(label: string): void {
		if (DbEftifyConfig.traceEnabled) {
			//console.time(label)
		}
	}

	static traceExecutionEnd(label: string): void {
		if (DbEftifyConfig.traceEnabled) {
			//console.timeEnd(label)
		}
	}
}
