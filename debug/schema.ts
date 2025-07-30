import { relations } from 'drizzle-orm';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { eftifyRelations } from '../src';
import { pgIntDatetime } from './customTypes/pgIntDatetime';

// ==================== USERS ====================
export const users = pgTable('users', {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity({ name: 'users_id_seq' }),
    name: text('name'),
    createdAt: pgIntDatetime('created_at').notNull()
});

export const usersRelations = eftifyRelations(users, ({ one, many, manyCustomDefined }) => ({
    userAddress: one(userAddress, {
        fields: [users.id],
        references: [userAddress.userId],
    }),
    posts: many(posts), //Standard drizzle syntax
    customPosts: manyCustomDefined(posts, {   //Custom eftify syntax allowing navigation specification
        fields: [users.id],
        references: [posts.authorId]
    })
}));

// ==================== USER ADDRESS ====================
export const userAddress = pgTable('user_address', {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity({ name: 'user_address_id_seq' }),
    userId: integer('sender_user_id').references(() => users.id),
    address: text('address'),
});

export const userAddressRelations = relations(userAddress, ({ one }) => ({
    user: one(users),
}));


// ==================== POST ====================
export const posts = pgTable('posts', {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity({ name: 'posts_id_seq' }),
    content: text('content'),
    authorId: integer('author_id'),
});
export const postsRelations = relations(posts, ({ one }) => ({
    author: one(users, {
        fields: [posts.authorId],
        references: [users.id],
    }),
}));

// ==================== USER GROUPS ====================
export const userGroups = pgTable('user_groups', {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity({ name: 'user_groups_id_seq' }),
    name: text('name'),
    usersIds: integer('user_ids').array(),
});
export const userGroupsRelations = eftifyRelations(userGroups, ({ manyFromKeyArray }) => ({
    users: manyFromKeyArray(users, {
        fields: [userGroups.usersIds],
        references: [users.id]
    })
}));

// ============ UNRELATED TABLE =================
export const unrelatedTable = pgTable('unrelated_table', {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity({ name: 'unrelated_table_id_seq' }),
    sometext: text('sometext'),
});