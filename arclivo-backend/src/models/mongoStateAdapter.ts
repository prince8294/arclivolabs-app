import { Collection, MongoClient, ServerApiVersion } from 'mongodb';
import { config } from '../config';

interface StateDocument<T> {
  _id: 'primary';
  revision: number;
  schemaVersion: number;
  updatedAt: Date;
  data: T;
}

export interface VersionedState<T> {
  data: T;
  revision: number;
}

let clientPromise: Promise<MongoClient> | undefined;

function getClient(): Promise<MongoClient> {
  if (!config.mongodbUri) throw new Error('MONGODB_URI is required for MongoDB persistence.');
  if (!clientPromise) {
    const client = new MongoClient(config.mongodbUri, {
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 30_000,
      serverSelectionTimeoutMS: 10_000,
      waitQueueTimeoutMS: 10_000,
      retryWrites: true,
      serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
    });
    clientPromise = client.connect().catch(error => {
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}

export class MongoStateAdapter<T extends { schemaVersion: number }> {
  private async collection(): Promise<Collection<StateDocument<T>>> {
    const client = await getClient();
    return client.db(config.mongodbDbName).collection<StateDocument<T>>(config.mongodbStateCollection);
  }

  async initialize(initialData: T): Promise<VersionedState<T>> {
    const collection = await this.collection();
    await collection.updateOne(
      { _id: 'primary' },
      {
        $setOnInsert: {
          revision: 0,
          schemaVersion: initialData.schemaVersion,
          updatedAt: new Date(),
          data: initialData,
        },
      },
      { upsert: true }
    );
    const current = await collection.findOne({ _id: 'primary' });
    if (!current) throw new Error('MongoDB state initialization did not return a document.');
    return { data: current.data, revision: current.revision };
  }

  async load(): Promise<VersionedState<T>> {
    const current = await (await this.collection()).findOne({ _id: 'primary' });
    if (!current) throw new Error('MongoDB state document is missing. Run the migration or initialize the database.');
    return { data: current.data, revision: current.revision };
  }

  async save(data: T, expectedRevision: number): Promise<number> {
    const result = await (await this.collection()).updateOne(
      { _id: 'primary', revision: expectedRevision },
      {
        $set: {
          data,
          schemaVersion: data.schemaVersion,
          updatedAt: new Date(),
        },
        $inc: { revision: 1 },
      }
    );
    if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
      throw new Error('MongoDB state changed concurrently. The operation was not committed.');
    }
    return expectedRevision + 1;
  }

  async ping(): Promise<void> {
    const client = await getClient();
    await client.db(config.mongodbDbName).command({ ping: 1 });
  }
}
