/**
 * Mock for MongoDB client for testing
 * This prevents Jest from trying to load the actual MongoDB package
 * which uses ESM exports that Jest has trouble with
 */

export const MongoClient = jest.fn().mockImplementation(() => ({
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
  db: jest.fn().mockReturnValue({
    command: jest.fn().mockResolvedValue({ ok: 1 }),
    collection: jest.fn().mockReturnValue({
      indexes: jest.fn().mockResolvedValue([]),
      createIndex: jest.fn().mockResolvedValue('index_name'),
      dropIndex: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
      insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock-id' }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    }),
  }),
  on: jest.fn(),
}));

export class Db {
  command = jest.fn().mockResolvedValue({ ok: 1 });
  collection = jest.fn().mockReturnValue({
    indexes: jest.fn().mockResolvedValue([]),
    createIndex: jest.fn().mockResolvedValue('index_name'),
  });
}

export class ObjectId {
  private id: string;

  constructor(id?: string) {
    this.id = id || 'mock-object-id';
  }

  toString() {
    return this.id;
  }

  toHexString() {
    return this.id;
  }

  static isValid(id: string) {
    return typeof id === 'string' && id.length === 24;
  }
}

export type MongoClientOptions = Record<string, unknown>;
