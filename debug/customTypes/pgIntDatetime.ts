import { customType } from 'drizzle-orm/pg-core';

const CUSTOM_EPOCH = 1735689600; // 2025-01-01T00:00:00Z in Unix seconds

const pgIntDatetimeImpl = customType<{
    data: Date; // type in queries
    driverData: number; // type in db
    columnType: 'number';
}>({
    dataType: () => 'integer',
    fromDriver: value => new Date((value + CUSTOM_EPOCH) * 1000),
    toDriver: (value) => {
        // Convert Date to seconds since custom epoch
        const timestampInSeconds = Math.floor(value.getTime() / 1000);
        return timestampInSeconds - CUSTOM_EPOCH;
    },
});

export const pgIntDatetime = (columnName: string) => {
    const retVal = pgIntDatetimeImpl(columnName);
    (retVal as any).config._in4dt = true;
    return retVal;
};
