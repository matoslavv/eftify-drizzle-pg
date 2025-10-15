import { AnyColumn, Column, One, OneOrMany, SQL, Table, aliasedTableColumn, and, eq, getTableColumns, is, sql } from 'drizzle-orm'
import { DbEntity } from './db-entity'
import { DbQueryRelation } from './db-query-relation'
import DbEftifyConfig from './db-eftify-config';
import { EftifyCollectionJoinDeclaration } from './data-contracts';

export class DbQueryCommon {
	/**
	 * Checks if the fields object contains any nested proxy structures that need flattening.
	 * Returns true if flattening is needed, false if the user has already manually selected columns.
	 */
	static needsFlattening(fields: any): boolean {
		for (let [key, value] of Object.entries(fields)) {
			if (value && typeof value === 'object') {
				const hasSubqueryStructure = (value as any)._ && ((value as any)._.sql || (value as any)._.selectedFields);
				if (hasSubqueryStructure) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * Flattens nested proxy objects (from leftJoin selectors) into a flat structure of column references.
	 * This prevents Drizzle's orderSelectedFields from hitting stack overflows on circular references.
	 * Only use this when the user passes whole proxy objects like { user, cte }.
	 */
	static flattenProxyStructure(fields: any): any {
		const flattened: any = {};

		for (let [key, value] of Object.entries(fields)) {
			if (value && typeof value === 'object') {
				// Check if this is a proxy object containing column references
				const hasSubqueryStructure = (value as any)._ && ((value as any)._.sql || (value as any)._.selectedFields);

				if (hasSubqueryStructure) {
					// This is a CTE/subquery proxy - extract its columns with prefixed keys
					const selectedFields = (value as any)._.selectedFields || {};
					for (let [colName, colValue] of Object.entries(selectedFields)) {
						// Use a prefixed key to avoid collisions: user_id, cte_userId, etc.
						const flatKey = `${key}_${colName}`;
						// Alias the column to match the flat key for unambiguous selection
						if (is(colValue, Column)) {
							flattened[flatKey] = sql`${colValue}`.as(flatKey);
						} else if (is(colValue, SQL.Aliased)) {
							// Already aliased, but we need to re-alias with our prefix
							flattened[flatKey] = sql`${colValue}`.as(flatKey);
						} else {
							flattened[flatKey] = colValue;
						}
					}
				} else if (is(value, Column) || is(value, SQL) || is(value, SQL.Aliased)) {
					// This is already a column reference, keep it as-is
					flattened[key] = value;
				} else {
					// This is a plain object, recurse
					const nested = DbQueryCommon.flattenProxyStructure({ [key]: value });
					for (let [nestedKey, nestedValue] of Object.entries(nested)) {
						flattened[nestedKey] = nestedValue;
					}
				}
			} else {
				flattened[key] = value;
			}
		}

		return flattened;
	}

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

				fields[name].eftifyFormatColumn = {
					fieldName: name,
					selection: (field as EftifyCollectionJoinDeclaration).mapFromDriverDefinition.selectedColumns,
					childSelections: (field as EftifyCollectionJoinDeclaration).mapFromDriverDefinition.childSelections
				}

				field = fields[name];
			}

			if (typeof name !== 'string' || is(field, SQL) || is(field, SQL.Aliased)) {
				continue
			}

			if (is(field, Column)) {
				if (field.name != name && fixColumnNames) {
					if (!DbEftifyConfig.pgForAliasedColumnsReturnDateAsUTC) {
						fields[name] = sql`${field}`.as(`${name}`);

						if ((field as any)._origCol == null) {
							fields[name]._origCol = field;
						}
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
				const columns = table[Symbol.for('drizzle:Columns')];
				const tableColumnNames = Object.keys(columns) || [];
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
			} else if (typeof field === 'object' && field !== null) {
				// Check if this is a subquery/CTE proxy object (has _ property with special structure)
				// These should not be recursively expanded as they're already processed
				const hasSubqueryStructure = (field as any)._ && ((field as any)._.sql || (field as any)._.selectedFields);
				if (hasSubqueryStructure) {
					// This is a CTE or subquery proxy - keep it as is, don't recurse
					continue;
				}

				// Otherwise, recurse into the object
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
		if (relationItem.relation.customRelationDefinition?.buildJoinSql != null) {
			return relationItem.relation.customRelationDefinition.buildJoinSql({
				childEntity: relationItem.childEntity,
				callingEntity: relationItem.callingEntity,
				keyPairs
			});
		}

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

	/** @internal */
	static getTraceMessage(queryType: 'firstOrDefault' | 'toList'): string {
		return `Executing query ${queryType}, query ID: q${new Date().getTime()}`
	}



	static setFormatColumnsOnBaseQuery(instance: any, select: any, columns: any) {
		const formatCollection = [];
		for (let [name, field] of Object.entries(columns)) {
			const eftifyCol = (field as any).eftifyFormatColumn ?? (field as any).sql?.eftifyFormatColumn;
			if (eftifyCol != null) {
				formatCollection.push({
					fieldName: name,
					selection: eftifyCol.selection,
					childSelections: eftifyCol.childSelections
				});
			}
		}

		(select as any)._formatCollections = formatCollection;
	}

	static restoreSubqueryFormatColumnsFromBaseQuery(baseQuery: any, subquery: any) {
		if (baseQuery._formatCollections?.length > 0) {
			for (const formatter of baseQuery._formatCollections) {
				subquery[formatter.fieldName].sql.eftifyFormatColumn = formatter;
			}
		}
	}

	static mapCollectionValuesFromDriver(formatCollections: any[], result: any[], decoderCache?: Map<string, any>, keyPrefix?: string) {
		if (formatCollections?.length > 0) {
			if (decoderCache == null) {
				decoderCache = new Map<string, any>();
			}

			if (keyPrefix == null) {
				keyPrefix = '';
			}

			for (const item of result) {
				for (const formatField of formatCollections) {
					let collectionField = item[formatField.fieldName];
					if (collectionField == null) {
						item[formatField.fieldName] = [];
						collectionField = item[formatField.fieldName]
					}

					const hasChildren = formatField.childSelections?.length > 0;

					for (const collectionItem of collectionField) {
						if (hasChildren) {
							const colItemArr = [collectionItem];
							for (const childSelection of formatField.childSelections) {
								DbQueryCommon.mapCollectionValuesFromDriver([childSelection], colItemArr, decoderCache, keyPrefix + '-' + formatField.fieldName + childSelection.fieldName);
							}
						}

						for (let [name, field] of Object.entries(collectionItem)) {
							if (field == null) {
								continue;
							}

							let decoder = decoderCache.get(keyPrefix + formatField.fieldName + '-' + name);
							if (decoder != null) {
								collectionItem[name] = decoder(field);
								continue;
							}

							const selectionField = formatField.selection[name];
							if (selectionField?.mapFromDriverValue != null) {
								// Bind the context to the column object for proper this binding
								decoder = (val: any) => selectionField.mapFromDriverValue.call(selectionField, val);
								decoderCache.set(keyPrefix + formatField.fieldName + '-' + name, decoder);
								collectionItem[name] = decoder(field);
								continue;
							}

							if (selectionField?._origCol?.mapFromDriverValue != null) {
								decoder = (val: any) => selectionField._origCol.mapFromDriverValue.call(selectionField._origCol, val);
								decoderCache.set(keyPrefix + formatField.fieldName + '-' + name, decoder);
								collectionItem[name] = decoder(field);
								continue;
							}

							if (selectionField?.decoder != null) {
								decoder = selectionField.decoder.mapFromDriverValue;
								if (decoder != null) {
									decoderCache.set(keyPrefix + formatField.fieldName + '-' + name, decoder);
									collectionItem[name] = decoder(field);
									continue;
								}
							}

							if (selectionField?.sql?.decoder != null) {
								decoder = selectionField.sql.decoder.mapFromDriverValue;
								if (decoder != null) {
									decoderCache.set(keyPrefix + formatField.fieldName + '-' + name, decoder);
									collectionItem[name] = decoder(field);
									continue;
								}
							}
						}
					}
				}
			}
		}
	}
}
