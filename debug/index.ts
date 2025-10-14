import 'dotenv/config';
import postgres from "postgres";
import * as schema from './schema';
import { drizzleEftify, DbCteBuilder } from './../src/';
import { and, eq, lt, ne, sql } from 'drizzle-orm';

export enum UserStateFlags {
	Active = 1,
	Verified = 2,
	Slave = 4,
	Banned = 8,
}

const getDbUrl = () => {
	if (process.env.DB_URL == null || process.env.DB_URL?.toString()?.trim()?.length == 0) {
		throw 'No DB_URL provided in the .env file, aborting'
	}

	return process.env.DB_URL;
}


const queryConnection = postgres(getDbUrl());
const drizzleEftified = drizzleEftify.create(queryConnection, {
	logger: true,
	schema: schema
});


(async function () {
	try {
		const dbContext = drizzleEftified.eftify;

		//All users without projection
		const allUsers = await dbContext.users.toList();

		//All users without projection, sorted
		const sortedUsers = await dbContext.users.orderBy(p => [p.name, p.id]).toList();

		//Formatter support for nested collections
		const nestedFormat = await dbContext.users.select(p => ({
			id: p.id,
			posts: p.posts.select(p => ({     //Basic One-to-many collection support
				id: p.id,
				text: p.content,
				createdAt: p.createdAt,
				comenty: p.postComments.select(com => ({
					id: com.id,
					text: com.content,
					vytvor: com.createdAt
				})).toList('comenty')
			})).toList('posts')
		})).select(p => ({
			id: p.id,
			postery: p.posts
		})).toList()

		//Queries list
		const userList = await dbContext.users.where(p => lt(p.id, 90)).select(p => ({
			id: p.id,
			address: p.userAddress
		})).toList();

		//Queries list
		const result = await dbContext.users.where(p => lt(p.id, 90)).select(p => ({
			id: p.id,
			street: p.userAddress.address,    //Navigation properties in similar manner like in EF
			posts: p.posts.select(p => ({     //Basic One-to-many collection support
				id: p.id,
				text: p.content
			})).toList('posts')               //Due to limitations requires name specification
		})).toList();

		//Queries list obtaining "many" navigation property defined using the {manyCustomDefined} syntax
		const customPostsResult = await dbContext.users.where(p => lt(p.id, 90)).select(p => ({
			id: p.id,
			street: p.userAddress.address,
			custTotal: p.customPosts.select(p => ({
				id: p.id,
				text: p.content
			})).toList('customPosts')
		})).toList();

		//Querying from entity joined by array column
		const allGroups = await dbContext.userGroups.select(p => ({
			id: p.id,
			name: p.name,
			users: p.users.select(u => ({
				id: u.id,
				name: u.name
			})).toList('users')
		})).toList();

		//Navigating through 2 levels of entities obtaining collection (fixed in 0.0.7)
		const nestedResults = await dbContext.userAddress.select(p => ({
			id: p.id,
			posts: p.user.posts.select(p => ({
				id: p.id,
				content: p.content
			})).toList('posts')
		})).toList();

		//Obtaining author name from post (possibly fixed in 0.0.5)
		const otherWay = dbContext.posts.where(p => eq(p.authorId, 3)).select(p => ({
			id: p.id,
			authorId: p.author.name
		})).firstOrDefault();

		//Simple sum
		const summary = await dbContext.users.where(p => and(
			lt(p.id, 2),
			ne(p.id, 0)
		)).sum(p => p.id);

		//Count query
		const userCount = await dbContext.users.where(p => and(
			lt(p.id, 2),
			ne(p.id, 0)
		)).count();

		//Grouping example
		const groupedResult = await dbContext.users.select(p => ({
			id: p.id,
			street: p.userAddress.address,
			name: p.name
		})).groupBy(p => ({
			street: p.street
		})).select(p => ({
			idCount: p.count(),
			idSum: p.sum(p => p.id),
			street: p.key.street     //Key property holds the grouping key similar to EF Core
		})).toList();

		//Insert example + transaction
		//In case of error thrown in the "async trx" section, it's automatically rolled back
		try {
			const userRow = await dbContext.transaction(async trx => {
				const userRow = await trx.users.insert({
					name: 'new user',
					createdAt: new Date(),
				}).returning({
					id: trx.users.getUnderlyingEntity().id
				});

				//If no chunk size specified, it's autodetected based on object size and PG default parameter count
				const userRowsBulk = await trx.users.insertBulk([
					{ name: 'new user bulk1', createdAt: new Date(), },
					{ name: 'new user bulk2', createdAt: new Date() },
					{ name: 'new user bulk3', createdAt: new Date() },
					{ name: 'new user bulk4', createdAt: new Date() },
				], { chunkSize: 1 }).returning({
					id: trx.users.getUnderlyingEntity().id
				});

				const userAddressRow = await trx.userAddress.insert({
					userId: userRow[0].id,
					address: 'some address'
				});

				return { id: userRow[0].id };
			});

			//Performs bulk update updating only the "name" field
			const userRowsBulkUpsert = await dbContext.users.upsertBulk([
				{ id: 1, name: `name changed upsert ${new Date().getTime()}`, createdAt: new Date() },
				{ id: 2, name: `name changed upsert ${new Date().getTime()}`, createdAt: new Date() }
			], {
				updateColumns: [
					dbContext.users.getUnderlyingEntity().name
				]
			});

			const z = "ok";

		} catch (error) {
			console.error(error);
		}

		//Transaction rollback
		try {
			await dbContext.transaction(async trx => {
				const userRow = await trx.users.insert({
					name: 'new user - will be rolled back',
					createdAt: new Date()
				}).returning({
					id: trx.users.getUnderlyingEntity().id
				});

				const userAddressRow = await trx.userAddress.insert({
					userId: userRow[0].id,
					address: 'some address'
				});

				await trx.rollback();
			});
		} catch (error) { }

		//Update example
		const affectedCount = await dbContext.users.where(p => eq(p.id, 1)).update({
			name: 'changed name'
		});

		const unrelatedRow = await dbContext.unrelatedTable.insert({
			sometext: "some text"
		}).returning();

		const user = await dbContext.users.where(p => eq(p.name, "new user bulk1")).firstOrDefault();
		await dbContext.posts.insert({
			content: "new post content",
			authorId: user.id,
			unrelatedId: unrelatedRow[0].id,
			createdAt: new Date()
		});

		const nestedObject = await dbContext.users.where(p => eq(p.name, "new user bulk1")).select(p => ({
			posts: p.posts.select(post => ({
				subqueryUnrelated: {
					id: post.unrelatedTable.id,
					sometext: post.unrelatedTable.sometext
				},
			})).toList('posts'),
		})).firstOrDefault();

		//Simple CTE example
		const cteActiveBuilder = new DbCteBuilder(dbContext.db);
		const activeUsersCte = cteActiveBuilder.with(
			'active_users',
			dbContext.users
				.where(p => lt(p.id, 100))
				.select(p => ({
					userId: p.id,
					customPostCount: p.customPosts.select(cp => ({ id: cp.id })).count().as('customPostCount')
				}))
		);

		const cteResult = await dbContext.users
			.where(p => eq(p.id, 1))
			.with(activeUsersCte.cte)
			.leftJoin(
				activeUsersCte.cte,
				// Join condition
				(user, cte) => eq(user.id, cte.userId),
				// Select columns from both table and CTE
				(user, cte) => ({
					id: user.id,
					name: user.name,
					crash: user.userAddress.address,
					customCount: cte.customPostCount  // Access CTE column!
				})
			)
			.toList();



		const cteAggrBuilder = new DbCteBuilder(dbContext.db);
		const aggregatedCte = cteAggrBuilder.withAggregation(
			'aggregated_users',
			dbContext.userAddress.select(p => ({
				id: p.id,
				userId: p.userId,
				street: p.address,
			})).groupBy(p => ({
				userId: p.userId,
				street: p.street
			})).select(p => ({
				userId: p.key.userId,
				idCount: p.count(),
				idSum: p.sum(p => p.id),
				street: p.key.street     //Key property holds the grouping key similar to EF Core
			})),
			p => ({ userId: p.userId }),
			'items'
		);

		const aggregatedCteResult = await dbContext.users
			.where(p => eq(p.id, 1))
			.with(...cteAggrBuilder.getCtes())
			.leftJoinSelect(
				aggregatedCte.cte,
				// Join condition
				(user, cte) => eq(user.id, cte.userId),
				// Select columns from both table and CTE
				(user, cte) => ({
					id: user.id,
					name: user.name,
					aggregatedItems: cte.items  // Access the aggregated array column!
				})
			)
			.toList();

		const finalRes = aggregatedCteResult;

		// Combined CTEs example - using MULTIPLE CTEs in a single query
		// This demonstrates the .NET EF Core-like join pattern with leftJoin
		const combinedCteBuilder = new DbCteBuilder(dbContext.db);

		// First CTE: Active users with custom post counts
		const activeUsersCte2 = combinedCteBuilder.with(
			'active_users_combined',
			dbContext.users
				.where(p => lt(p.id, 100))
				.select(p => ({
					userId: p.id,
					userName: sql`${p.name}`.as('userName'),  // Alias to avoid ambiguity
					customPostCount: p.customPosts.select(cp => ({ id: cp.id })).count().as('customPostCount')
				}))
		);

		// Second CTE: Aggregated user addresses (note: using same builder!)
		const aggregatedCte2 = combinedCteBuilder.withAggregation(
			'aggregated_addresses_combined',
			dbContext.userAddress.select(p => ({
				id: p.id,
				userId: p.userId,
				street: p.address,
			})).groupBy(p => ({
				userId: p.userId,
				street: p.street
			})).select(p => ({
				userId: p.key.userId,
				addressCount: p.count(),
				street: p.key.street
			})),
			p => ({ userId: p.userId }),
			'addresses'
		);

		// NEW PATTERN: Using leftJoin (similar to .NET EF Core)
		// After flattening, columns are accessible with prefixed keys
		const combinedCteResult = await dbContext.users
			.where(p => eq(p.id, 1))
			.with(...combinedCteBuilder.getCtes())  // Pass ALL CTEs at once!
			.leftJoin(
				activeUsersCte2.cte,
				(user, activeCte) => eq(user.id, activeCte.userId),
				(user, activeCte) => ({
					userId: user.id,
					userName: user.name,
					customPostCount: activeCte.customPostCount,
					originalUserName: activeCte.userName
				})
			)
			// Chain second leftJoin
			.leftJoin(
				aggregatedCte2.cte,
				(prev, addrCte) => eq(prev.userId, addrCte.userId),
				(prev, addrCte) => ({
					userId: prev.userId,
					userName: prev.userName,
					customPostCount: prev.customPostCount,
					aggregatedAddresses: addrCte.addresses
				})
			)
			.toList();

		const combinedResult = combinedCteResult;

		// LEFT JOIN TWO QUERYABLES (without CTEs)
		// This demonstrates joining two regular queries together
		// Example: Join users with their aggregated post statistics

		// Second queryable: Post statistics per user (grouped by author)
		const postStatsQuery = dbContext.posts
			.select(p => ({
				authorId: p.authorId,
				postContent: p.content
			}))
			.groupBy(p => ({
				authorId: p.authorId
			}))
			.select(p => ({
				authorId: p.key.authorId,
				postCount: p.count()
			}));

		// Now join them together using leftJoin!
		// Convert the second query to a CTE-like structure using .with()
		const postStatsCte = dbContext.db.$with('post_stats').as(postStatsQuery.toDrizzleQuery());

		const joinedQueryables = await dbContext.users
			.where(p => lt(p.id, 10))
			.with(postStatsCte)
			.leftJoin(
				postStatsCte,
				(user, stats) => eq(user.id, stats.authorId),
				(user, stats) => ({
					userId: user.id,
					userName: sql`${user.name}`.as('userName'),
					postCount: stats.postCount
				})
			)
			.toList();

		console.log('Joined queryables result:', joinedQueryables);

		// TEST NAVIGATION PROPERTIES IN LEFT JOIN
		// This tests that navigation properties (like user.userAddress.address) work in leftJoin
		const navTestCteBuilder = new DbCteBuilder(dbContext.db);
		const navTestCte = navTestCteBuilder.with(
			'active_users_nav_test',
			dbContext.users
				.where(p => lt(p.id, 100))
				.select(p => ({
					userId: p.id,
					customPostCount: p.customPosts.select(cp => ({ id: cp.id })).count().as('customPostCount')
				}))
		);

		const navigationTestResult = await dbContext.users
			.where(p => eq(p.id, 1))
			.with(navTestCte.cte)
			.leftJoin(
				navTestCte.cte,
				(user, cte) => eq(user.id, cte.userId),
				(user, cte) => ({
					id: user.id,
					name: sql`${user.name}`.as('name'),
					address: user.userAddress.address,  // Navigation property!
					customCount: cte.customPostCount
				})
			)
			.toList();

		console.log('Navigation property test result:', navigationTestResult);

		// TEST LEFT JOIN WITH DBQUERYABLE (not CTE)
		// This demonstrates joining with a DbQueryable directly
		const postsQueryable = dbContext.posts
			.select(p => ({
				authorId: p.authorId,
				postId: p.id
			}))
			.groupBy(p => ({ authorId: p.authorId }))
			.select(p => ({
				authorId: p.key.authorId,
				postCount: p.count()
			}));

		const queryableJoinResult = await dbContext.users
			.where(p => lt(p.id, 5))
			.leftJoin(
				postsQueryable,  // Pass DbQueryable directly, not a CTE!
				(user, posts) => eq(user.id, posts.authorId),
				(user, posts) => ({
					userId: user.id,
					userName: sql`${user.name}`.as('userName'),
					postCount: posts.postCount
				})
			)
			.toList();

		console.log('DbQueryable join result:', queryableJoinResult);

	} catch (error) {
		const pica = error;
		console.error('Error:', error);
	}
})();


