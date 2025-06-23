import 'dotenv/config';
import postgres from "postgres";
import * as schema from './schema';
import { drizzleEftify } from './../src/';
import { and, eq, lt, ne, sql } from 'drizzle-orm';


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
                    name: 'new user'
                }).returning({
                    id: trx.users.getUnderlyingEntity().id
                });

                const userAddressRow = await trx.userAddress.insert({
                    userId: userRow[0].id,
                    address: 'some address'
                });

                return { id: userRow[0].id };
            });
        } catch (error) {
            console.error(error);
        }

        //Transaction rollback
        try {
            await dbContext.transaction(async trx => {
                const userRow = await trx.users.insert({
                    name: 'new user - will be rolled back'
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
    } catch (error) {
        const pica = error;
    }
})();


