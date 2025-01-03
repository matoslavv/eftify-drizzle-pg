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

        //Queries list
        const result = await dbContext.users.where(p => lt(p.id, 90)).select(p => ({
            id: p.id,
            street: p.userAddress.address,    //Navigation properties in similar manner like in EF
            posts: p.posts.select(p => ({     //Basic One-to-many collection support
                id: p.id,
                text: p.content
            })).toList('posts')               //Due to limitations requires name specification
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
        const userRow = await dbContext.transaction(async trx => {
            try {
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
            } catch (error) {
                await trx.rollback();
                return null;
            }
        });

        //Update example
        const affectedCount = await dbContext.users.where(p => eq(p.id, 1)).update({
            name: 'changed name'
        });
    } catch (error) {
        const pica = error;
    }
})();


