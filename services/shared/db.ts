import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  QueryCommandInput,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

/**
 * Every table uses the same generic key layout: PK/SK plus up to three GSIs
 * (GSI1PK/GSI1SK ... GSI3PK/GSI3SK). Items carry their own key attributes.
 */
export type Item = Record<string, any> & { PK: string; SK: string };
export type IndexName = 'GSI1' | 'GSI2' | 'GSI3';

export interface QueryOptions {
  index?: IndexName;
  pk: string;
  skPrefix?: string;
  /** false = descending sort key order */
  forward?: boolean;
  limit?: number;
}

export interface Db {
  get<T = Item>(table: string, pk: string, sk: string): Promise<T | undefined>;
  put(table: string, item: Item): Promise<void>;
  delete(table: string, pk: string, sk: string): Promise<void>;
  /** Returns all matching items (follows pagination). Demo-scale data only. */
  query<T = Item>(table: string, opts: QueryOptions): Promise<T[]>;
  batchGet<T = Item>(table: string, keys: { PK: string; SK: string }[]): Promise<T[]>;
  /** Atomically adds `by` to a numeric attribute and returns the new value. */
  increment(table: string, pk: string, sk: string, attr: string, by?: number): Promise<number>;
  /** Deletes every item whose PK starts with the prefix. Used by the demo reset. */
  deleteByPkPrefix(table: string, prefix: string): Promise<number>;
}

export class DynamoDb implements Db {
  private doc: DynamoDBDocumentClient;

  constructor(client = new DynamoDBClient({})) {
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async get<T>(table: string, pk: string, sk: string): Promise<T | undefined> {
    const res = await this.doc.send(new GetCommand({ TableName: table, Key: { PK: pk, SK: sk } }));
    return res.Item as T | undefined;
  }

  async put(table: string, item: Item): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: table, Item: item }));
  }

  async delete(table: string, pk: string, sk: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: table, Key: { PK: pk, SK: sk } }));
  }

  async query<T>(table: string, opts: QueryOptions): Promise<T[]> {
    const pkName = opts.index ? `${opts.index}PK` : 'PK';
    const skName = opts.index ? `${opts.index}SK` : 'SK';
    const input: QueryCommandInput = {
      TableName: table,
      IndexName: opts.index,
      KeyConditionExpression: opts.skPrefix ? '#pk = :pk AND begins_with(#sk, :sk)' : '#pk = :pk',
      ExpressionAttributeNames: opts.skPrefix ? { '#pk': pkName, '#sk': skName } : { '#pk': pkName },
      ExpressionAttributeValues: opts.skPrefix ? { ':pk': opts.pk, ':sk': opts.skPrefix } : { ':pk': opts.pk },
      ScanIndexForward: opts.forward ?? true,
    };
    const out: T[] = [];
    let start: Record<string, any> | undefined;
    do {
      const res = await this.doc.send(new QueryCommand({ ...input, ExclusiveStartKey: start }));
      out.push(...((res.Items ?? []) as T[]));
      start = res.LastEvaluatedKey;
    } while (start && (!opts.limit || out.length < opts.limit));
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  async batchGet<T>(table: string, keys: { PK: string; SK: string }[]): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < keys.length; i += 100) {
      let request: Record<string, any> | undefined = { [table]: { Keys: keys.slice(i, i + 100) } };
      while (request && Object.keys(request).length) {
        const res: any = await this.doc.send(new BatchGetCommand({ RequestItems: request }));
        out.push(...((res.Responses?.[table] ?? []) as T[]));
        request = res.UnprocessedKeys;
      }
    }
    return out;
  }

  async increment(table: string, pk: string, sk: string, attr: string, by = 1): Promise<number> {
    const res = await this.doc.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: pk, SK: sk },
        UpdateExpression: 'ADD #a :by',
        ExpressionAttributeNames: { '#a': attr },
        ExpressionAttributeValues: { ':by': by },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(res.Attributes?.[attr] ?? 0);
  }

  async deleteByPkPrefix(table: string, prefix: string): Promise<number> {
    let count = 0;
    let start: Record<string, any> | undefined;
    do {
      const res = await this.doc.send(
        new ScanCommand({
          TableName: table,
          ProjectionExpression: 'PK, SK',
          FilterExpression: 'begins_with(PK, :p)',
          ExpressionAttributeValues: { ':p': prefix },
          ExclusiveStartKey: start,
        }),
      );
      const keys = (res.Items ?? []).map((i) => ({ PK: i.PK, SK: i.SK }));
      for (let i = 0; i < keys.length; i += 25) {
        let request: Record<string, any> | undefined = {
          [table]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })),
        };
        while (request && Object.keys(request).length) {
          const out: any = await this.doc.send(new BatchWriteCommand({ RequestItems: request }));
          request = out.UnprocessedItems;
        }
      }
      count += keys.length;
      start = res.LastEvaluatedKey;
    } while (start);
    return count;
  }
}

/** In-memory implementation used by unit tests. Mirrors DynamoDB key semantics closely enough for our access patterns. */
export class MemoryDb implements Db {
  tables = new Map<string, Map<string, Item>>();

  private table(name: string) {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }

  async get<T>(table: string, pk: string, sk: string): Promise<T | undefined> {
    const item = this.table(table).get(`${pk}|${sk}`);
    return item ? (structuredClone(item) as T) : undefined;
  }

  async put(table: string, item: Item): Promise<void> {
    const clean = JSON.parse(JSON.stringify(item));
    this.table(table).set(`${item.PK}|${item.SK}`, clean);
  }

  async delete(table: string, pk: string, sk: string): Promise<void> {
    this.table(table).delete(`${pk}|${sk}`);
  }

  async query<T>(table: string, opts: QueryOptions): Promise<T[]> {
    const pkName = opts.index ? `${opts.index}PK` : 'PK';
    const skName = opts.index ? `${opts.index}SK` : 'SK';
    const items = [...this.table(table).values()]
      .filter((i) => i[pkName] === opts.pk && i[skName] !== undefined)
      .filter((i) => !opts.skPrefix || String(i[skName]).startsWith(opts.skPrefix))
      .sort((a, b) => (a[skName] < b[skName] ? -1 : a[skName] > b[skName] ? 1 : 0));
    if (opts.forward === false) items.reverse();
    const limited = opts.limit ? items.slice(0, opts.limit) : items;
    return structuredClone(limited) as T[];
  }

  async batchGet<T>(table: string, keys: { PK: string; SK: string }[]): Promise<T[]> {
    const out: T[] = [];
    for (const k of keys) {
      const item = await this.get<T>(table, k.PK, k.SK);
      if (item) out.push(item);
    }
    return out;
  }

  async increment(table: string, pk: string, sk: string, attr: string, by = 1): Promise<number> {
    const t = this.table(table);
    const key = `${pk}|${sk}`;
    const item = t.get(key) ?? { PK: pk, SK: sk };
    item[attr] = Number(item[attr] ?? 0) + by;
    t.set(key, item);
    return item[attr];
  }

  async deleteByPkPrefix(table: string, prefix: string): Promise<number> {
    const t = this.table(table);
    let n = 0;
    for (const [k, v] of t) {
      if (v.PK.startsWith(prefix)) {
        t.delete(k);
        n++;
      }
    }
    return n;
  }
}

let defaultDb: Db | undefined;
export function db(): Db {
  if (!defaultDb) defaultDb = new DynamoDb();
  return defaultDb;
}
export function setDb(d: Db) {
  defaultDb = d;
}

/** Builds a tenant-scoped key: key('acme', 'CLIENT', id) => 'T#acme#CLIENT#<id>' */
export function key(tenant: string, ...parts: string[]): string {
  return ['T', tenant, ...parts].join('#');
}

/** Strips key attributes before returning items to callers. */
export function strip<T>(item: any): T {
  if (!item) return item;
  const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, GSI3PK, GSI3SK, ...rest } = item;
  return rest as T;
}

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}
