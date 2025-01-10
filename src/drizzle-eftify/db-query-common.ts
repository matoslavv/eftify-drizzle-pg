import { AnyColumn, Column, One, OneOrMany, SQL, Table, aliasedTableColumn, and, eq, getTableColumns, is, sql } from 'drizzle-orm'
import { DbEntity } from './db-entity'
import { DbQueryRelation } from './db-query-relation'
import DbEftifyConfig from './db-eftify-config';
import { EftifyCollectionJoinDeclaration } from './data-contracts';

export class DbQueryCommon {
	static ensureColumnAliased(fields: any, fixColumnNames: boolean, relationArr: DbQueryRelation[], opData?: { count: number; names: { [index: string]: boolean } }) {
		opData = opData || { count: 0, names: {} }



		for (let [name, field] of Object.entries(fields)) {
			if ((field as EftifyCollectionJoinDeclaration).isCollectionDeclaration) {
				if (relationArr != null) {
					relationArr.push({
						callingEntity: null,
						childEntity: null,
						relation: null,
						uniqueKey: (field as EftifyCollectionJoinDeclaration).id + (field as EftifyCollectionJoinDeclaration).columnName,
						joinDeclaration: {
							sql: (field as EftifyCollectionJoinDeclaration).sql,
							isLateral: true
						}
					});

					const baseChunks = (field as EftifyCollectionJoinDeclaration).sql.queryChunks;
					(baseChunks as any)[0].value[0] = `(SELECT COALESCE(json_agg(${(field as EftifyCollectionJoinDeclaration).id}.*),'[]') as "${(field as EftifyCollectionJoinDeclaration).columnName}" from `;
					(baseChunks[baseChunks.length - 1] as any).value[0] = (baseChunks[baseChunks.length - 1] as any).value[0] + ` "${(field as EftifyCollectionJoinDeclaration).id}" `;

					const retQuery = sql`IDREPLACE.*`;
					(retQuery as any).queryChunks[0].value[0] = (retQuery as any).queryChunks[0].value[0].replace('IDREPLACE', (field as EftifyCollectionJoinDeclaration).id);
					fields[name] = retQuery.as((field as EftifyCollectionJoinDeclaration).columnName);
				} else {
					fields[name] = (field as EftifyCollectionJoinDeclaration).sql.as((field as EftifyCollectionJoinDeclaration).columnName);
				}

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
				const table = field.constructor.prototype.table;
				const tableColumnNames = Object.values(getTableColumns(table))?.map((p: any) => p.name) || [];
				const objBuilder: any = {};
				for (const fieldName of tableColumnNames) {
					objBuilder[fieldName] = field[fieldName as keyof typeof field];
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
				if (relationItem.joinDeclaration != null) {
					select = (select as any).leftJoin(
						relationItem.joinDeclaration.sql,
						true
					) as any

					if (relationItem.joinDeclaration.isLateral) {
						const joinsArr: any[] = (select as any).config.joins;
						joinsArr[joinsArr.length - 1].lateral = true;
					}
				} else if (relationItem.relation.mandatory) {
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
