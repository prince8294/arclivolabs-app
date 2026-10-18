"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MongoStateAdapter = void 0;
const mongodb_1 = require("mongodb");
const config_1 = require("../config");
let clientPromise;
function getClient() {
    if (!config_1.config.mongodbUri)
        throw new Error('MONGODB_URI is required for MongoDB persistence.');
    if (!clientPromise) {
        const client = new mongodb_1.MongoClient(config_1.config.mongodbUri, {
            maxPoolSize: 10,
            minPoolSize: 0,
            maxIdleTimeMS: 30_000,
            serverSelectionTimeoutMS: 10_000,
            waitQueueTimeoutMS: 10_000,
            retryWrites: true,
            serverApi: { version: mongodb_1.ServerApiVersion.v1, strict: true, deprecationErrors: true },
        });
        clientPromise = client.connect().catch(error => {
            clientPromise = undefined;
            throw error;
        });
    }
    return clientPromise;
}
class MongoStateAdapter {
    async collection() {
        const client = await getClient();
        return client.db(config_1.config.mongodbDbName).collection(config_1.config.mongodbStateCollection);
    }
    async initialize(initialData) {
        const collection = await this.collection();
        await collection.updateOne({ _id: 'primary' }, {
            $setOnInsert: {
                revision: 0,
                schemaVersion: initialData.schemaVersion,
                updatedAt: new Date(),
                data: initialData,
            },
        }, { upsert: true });
        const current = await collection.findOne({ _id: 'primary' });
        if (!current)
            throw new Error('MongoDB state initialization did not return a document.');
        return { data: current.data, revision: current.revision };
    }
    async load() {
        const current = await (await this.collection()).findOne({ _id: 'primary' });
        if (!current)
            throw new Error('MongoDB state document is missing. Run the migration or initialize the database.');
        return { data: current.data, revision: current.revision };
    }
    async save(data, expectedRevision) {
        const result = await (await this.collection()).updateOne({ _id: 'primary', revision: expectedRevision }, {
            $set: {
                data,
                schemaVersion: data.schemaVersion,
                updatedAt: new Date(),
            },
            $inc: { revision: 1 },
        });
        if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
            throw new Error('MongoDB state changed concurrently. The operation was not committed.');
        }
        return expectedRevision + 1;
    }
    async ping() {
        const client = await getClient();
        await client.db(config_1.config.mongodbDbName).command({ ping: 1 });
    }
}
exports.MongoStateAdapter = MongoStateAdapter;
