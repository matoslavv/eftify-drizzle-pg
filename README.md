# eftify-drizzle-pg

[![npm package][npm-img]][npm-url]
[![Build Status][build-img]][build-url]
[![Downloads][downloads-img]][downloads-url]
[![Issues][issues-img]][issues-url]

> EF Core-like queries using Drizzle ORM

## Install

```bash
npm install eftify-drizzle-pg
```

## About the library
Small library attempting to bring other relational syntax do Drizzle ORM. Might help anyone transitioning from EF Core who does not like the drizzle query API. As for now supports only Postgres database with limited functionality available. No guarantee given whatsover, use at your own risk.

Library can run alongside standard drizzle. All it does is create new "eftify" property on the root drizzle object with new API available.

## Usage

```ts
import { drizzleEftify } from 'eftify-drizzle-pg';
import { and, lt, ne } from 'drizzle-orm';
import * as schema from '../schema/schema';

const queryConnection = postgres(getDbUrl());
const drizzleEftified = drizzleEftify(queryConnection, {
	logger: appConfig.database.logQuery,
	schema: schema
});

(async () => {
    const dbContext = drizzleEftified.eftify;

    //Queries list
    const result = await dbContext.users.where(p => lt(p.id, 3)).select(p => ({
        id: p.id,
        street: p.userAddress.address,    //Navigation properties in similar manner like in EF
        posts: p.posts.select(p => ({     //Basic One-to-many collection support
            id: p.id,
            text: p.content
        })).toList('posty')               //Due to limitations requires name specification
    })).toList();

    //Single result
    const singleResult = await dbContext.users.where(p => lt(p.id, 3)).select(p => ({
        id: p.id,
        street: p.userAddress.address,    //Navigation properties in similar manner like in EF
        posts: p.posts.select(p => ({     //Basic One-to-many collection support
            id: p.id,
            text: p.content
        })).toList('posty')               //Due to limitations requires name specification
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

})();





```

## Sample schema

```ts
import { relations } from 'drizzle-orm';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';

// ==================== USERS ====================
export const users = pgTable('users', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity({name: 'users_id_seq'}),
	name: text('name'),
});

export const usersRelations = relations(users, ({ one, many }) => ({
	userAddress: one(userAddress, {
		fields: [users.id],
		references: [userAddress.userId],
	}),
	posts: many(posts),
}));

// ==================== USER ADDRESS ====================
export const userAddress = pgTable('user_address', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity({name: 'user_address_id_seq'}),
	userId: integer('sender_user_id').references(() => users.id),
	address: text('address'),
});

export const userAddressRelations = relations(userAddress, ({ one }) => ({
	user: one(users),
}));

// ==================== POST ====================
export const posts = pgTable('posts', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity({name: 'posts_id_seq'}),
	content: text('content'),
	authorId: integer('author_id'),
});
export const postsRelations = relations(posts, ({ one }) => ({
	author: one(users, {
		fields: [posts.authorId],
		references: [users.id],
	}),
}));

// ============ UNRELATED TABLE =================
export const unrelatedTable = pgTable('unrelated_table', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity({name: 'unrelated_table_id_seq'}),
	sometext: text('sometext'),
});
```



[build-img]:https://github.com/brunolau/eftify-drizzle-pg/actions/workflows/release.yml/badge.svg
[build-url]:https://github.com/brunolau/eftify-drizzle-pg/actions/workflows/release.yml
[downloads-img]:https://img.shields.io/npm/dt/eftify-drizzle-pg
[downloads-url]:https://www.npmtrends.com/eftify-drizzle-pg
[npm-img]:https://img.shields.io/npm/v/eftify-drizzle-pg
[npm-url]:https://www.npmjs.com/package/eftify-drizzle-pg
[issues-img]:https://img.shields.io/github/issues/brunolau/eftify-drizzle-pg
[issues-url]:https://github.com/brunolau/eftify-drizzle-pg/issues
