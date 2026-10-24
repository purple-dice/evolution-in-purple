import { getOnWhatsappCache, saveOnWhatsappCache } from '@utils/onWhatsappCache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { jid: string; remoteJid: string; lid: string | null; updatedAt: Date };

const mocks = vi.hoisted(() => ({
  database: { SAVE_DATA: { IS_ON_WHATSAPP: true, IS_ON_WHATSAPP_DAYS: 7 } },
  rows: new Map<string, Row>(),
  isOnWhatsappJid: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  transaction: vi.fn(),
  logger: { verbose: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@api/server.module', () => ({
  prismaRepository: { isOnWhatsappJid: mocks.isOnWhatsappJid, $transaction: mocks.transaction },
}));
vi.mock('@config/env.config', () => ({ configService: { get: vi.fn(() => mocks.database) } }));
vi.mock('@config/logger.config', () => ({
  Logger: class {
    verbose = mocks.logger.verbose;
    warn = mocks.logger.warn;
    error = mocks.logger.error;
  },
}));

const { rows, isOnWhatsappJid, transaction, logger } = mocks;

const uniqueViolation = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

const matches = (row: Row, where: any) =>
  (!where.jid || where.jid.in.includes(row.jid)) &&
  (!where.remoteJid || where.remoteJid.in.includes(row.remoteJid)) &&
  (!where.updatedAt || row.updatedAt >= where.updatedAt.gte);

const lazy = <T>(run: () => Promise<T>) => ({
  run,
  then: (resolve: (value: T) => unknown, reject: (reason: unknown) => unknown) => run().then(resolve, reject),
});

const installFake = () => {
  isOnWhatsappJid.findMany.mockImplementation(async ({ where }) =>
    [...rows.values()].filter((row) => matches(row, where)).map((row) => ({ ...row })),
  );
  isOnWhatsappJid.deleteMany.mockImplementation(({ where }) =>
    lazy(async () => {
      const targets = [...rows.values()].filter((row) => matches(row, where));
      targets.forEach((row) => rows.delete(row.jid));
      return { count: targets.length };
    }),
  );
  isOnWhatsappJid.createMany.mockImplementation(({ data }) =>
    lazy(async () => {
      for (const row of data) {
        if (rows.has(row.jid)) throw uniqueViolation();
      }
      for (const row of data) {
        rows.set(row.jid, { lid: null, updatedAt: new Date(), ...row });
      }
      return { count: data.length };
    }),
  );
  transaction.mockImplementation(async (operations: ReturnType<typeof lazy>[]) => {
    const results = [];
    for (const operation of operations) results.push(await operation.run());
    return results;
  });
};

const seed = (remoteJid: string, jids: string[], lid: string | null = null, updatedAt = new Date()) =>
  jids.forEach((jid) => rows.set(jid, { jid, remoteJid, lid, updatedAt }));

const group = (remoteJid: string) =>
  [...rows.values()]
    .filter((row) => row.remoteJid === remoteJid)
    .map((row) => row.jid)
    .sort();

const queriedJids = () => isOnWhatsappJid.findMany.mock.calls[0][0].where.jid.in;

beforeEach(() => {
  vi.clearAllMocks();
  rows.clear();
  mocks.database.SAVE_DATA.IS_ON_WHATSAPP = true;
  mocks.database.SAVE_DATA.IS_ON_WHATSAPP_DAYS = 7;
  installFake();
});

describe('getOnWhatsappCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an empty list without querying when the cache is disabled', async () => {
    mocks.database.SAVE_DATA.IS_ON_WHATSAPP = false;

    expect(await getOnWhatsappCache(['5511987654321@s.whatsapp.net'])).toEqual([]);
    expect(isOnWhatsappJid.findMany).not.toHaveBeenCalled();
  });

  it('only returns rows updated within the configured number of days', async () => {
    seed('15551234567@s.whatsapp.net', ['15551234567@s.whatsapp.net'], null, new Date('2026-01-01T00:00:00.000Z'));

    expect(await getOnWhatsappCache(['15551234567@s.whatsapp.net'])).toEqual([]);
    expect(isOnWhatsappJid.findMany.mock.calls[0][0].where.updatedAt.gte).toEqual(new Date('2026-01-08T12:00:00.000Z'));
  });

  it('returns the whole group with sorted jid options and lid using two queries', async () => {
    seed('5491123456789@s.whatsapp.net', ['5491123456789@s.whatsapp.net', '541123456789@s.whatsapp.net']);
    seed('5491123456789@s.whatsapp.net', ['999@lid'], 'lid');

    expect(await getOnWhatsappCache(['541123456789@s.whatsapp.net'])).toEqual([
      {
        remoteJid: '5491123456789@s.whatsapp.net',
        number: '5491123456789',
        jidOptions: ['541123456789@s.whatsapp.net', '5491123456789@s.whatsapp.net', '999@lid'],
        lid: 'lid',
      },
    ]);
    expect(isOnWhatsappJid.findMany).toHaveBeenCalledTimes(2);
    expect(isOnWhatsappJid.findMany.mock.calls[1][0].where.remoteJid.in).toEqual(['5491123456789@s.whatsapp.net']);
  });

  it('finds a group by its lid', async () => {
    seed('15551234567@s.whatsapp.net', ['15551234567@s.whatsapp.net', '888@lid']);

    const [result] = await getOnWhatsappCache(['888@lid']);

    expect(result.remoteJid).toBe('15551234567@s.whatsapp.net');
    expect(result.jidOptions).toEqual(['15551234567@s.whatsapp.net', '888@lid']);
  });

  it('returns one entry per group when several inputs hit the same group', async () => {
    seed('5511987654321@s.whatsapp.net', ['5511987654321@s.whatsapp.net', '551187654321@s.whatsapp.net']);
    seed('15551234567@s.whatsapp.net', ['15551234567@s.whatsapp.net']);

    const results = await getOnWhatsappCache([
      '5511987654321@s.whatsapp.net',
      '551187654321@s.whatsapp.net',
      '15551234567@s.whatsapp.net',
    ]);

    expect(results.map((result) => result.remoteJid).sort()).toEqual([
      '15551234567@s.whatsapp.net',
      '5511987654321@s.whatsapp.net',
    ]);
  });

  it('queries Brazilian numbers with and without the ninth digit', async () => {
    await getOnWhatsappCache(['5511987654321@s.whatsapp.net', '551187654321@s.whatsapp.net']);

    expect(queriedJids()).toEqual(['5511987654321@s.whatsapp.net', '551187654321@s.whatsapp.net']);
  });

  it('queries Argentine numbers with and without the 9 prefix', async () => {
    await getOnWhatsappCache(['542615550101@s.whatsapp.net']);

    expect(queriedJids()).toEqual(['5492615550101@s.whatsapp.net', '542615550101@s.whatsapp.net']);
  });

  it('queries Mexican numbers with and without the 1 prefix', async () => {
    await getOnWhatsappCache(['525512345678@s.whatsapp.net']);

    expect(queriedJids()).toEqual(['5215512345678@s.whatsapp.net', '525512345678@s.whatsapp.net']);
  });

  it('queries other numbers without the plus sign and with a single domain', async () => {
    await getOnWhatsappCache(['+15551234567@s.whatsapp.net']);

    expect(queriedJids()).toEqual(['15551234567@s.whatsapp.net']);
  });

  it('queries lid and group jids as given', async () => {
    await getOnWhatsappCache(['123456@lid', '5511999999999-1623281429@g.us']);

    expect(queriedJids()).toEqual(['123456@lid', '5511999999999-1623281429@g.us']);
  });

  it('queries numbers without a domain as user jids', async () => {
    await getOnWhatsappCache(['15551234567']);

    expect(queriedJids()).toEqual(['15551234567@s.whatsapp.net']);
  });

  it('skips the second query when nothing matches', async () => {
    expect(await getOnWhatsappCache(['15551234567@s.whatsapp.net'])).toEqual([]);
    expect(isOnWhatsappJid.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('saveOnWhatsappCache', () => {
  it('does nothing when the cache is disabled', async () => {
    mocks.database.SAVE_DATA.IS_ON_WHATSAPP = false;

    await saveOnWhatsappCache([{ remoteJid: '15551234567@s.whatsapp.net' }]);

    expect(isOnWhatsappJid.findMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('skips items without a remote jid', async () => {
    await saveOnWhatsappCache([{ remoteJid: '' }]);

    expect(transaction).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('[saveOnWhatsappCache] Item skipped, missing remoteJid.');
  });

  it('creates one row per variant pointing to the canonical remote jid', async () => {
    await saveOnWhatsappCache([{ remoteJid: '+5511987654321@s.whatsapp.net' }]);

    expect(group('5511987654321@s.whatsapp.net')).toEqual([
      '551187654321@s.whatsapp.net',
      '5511987654321@s.whatsapp.net',
    ]);
    expect(rows.get('551187654321@s.whatsapp.net')?.lid).toBeNull();
  });

  it('adds a lid alternate jid and marks the group as lid', async () => {
    await saveOnWhatsappCache([{ remoteJid: '5511987654321@s.whatsapp.net', remoteJidAlt: '999@lid', lid: 'lid' }]);

    expect(group('5511987654321@s.whatsapp.net')).toEqual([
      '551187654321@s.whatsapp.net',
      '5511987654321@s.whatsapp.net',
      '999@lid',
    ]);
    expect([...rows.values()].every((row) => row.lid === 'lid')).toBe(true);
  });

  it('ignores alternate jids that are not lids', async () => {
    await saveOnWhatsappCache([{ remoteJid: '999@lid', remoteJidAlt: '15550000000@s.whatsapp.net' }]);

    expect([...rows.keys()]).toEqual(['999@lid']);
    expect(rows.get('999@lid')).toMatchObject({ remoteJid: '999@lid', lid: 'lid' });
  });

  it('merges an existing group and makes the item remote jid canonical', async () => {
    seed('551187654321@s.whatsapp.net', ['551187654321@s.whatsapp.net', '888@lid'], 'lid', new Date('2020-01-01'));

    await saveOnWhatsappCache([{ remoteJid: '5511987654321@s.whatsapp.net' }]);

    expect(group('5511987654321@s.whatsapp.net')).toEqual([
      '551187654321@s.whatsapp.net',
      '5511987654321@s.whatsapp.net',
      '888@lid',
    ]);
    expect(group('551187654321@s.whatsapp.net')).toEqual([]);
    expect([...rows.values()].every((row) => row.lid === 'lid' && row.updatedAt > new Date('2020-01-01'))).toBe(true);
  });

  it('saves a jid repeated in one batch as a single group with both alternates', async () => {
    await saveOnWhatsappCache([
      { remoteJid: '5491123456789@s.whatsapp.net', remoteJidAlt: '111@lid' },
      { remoteJid: '5491123456789@s.whatsapp.net', remoteJidAlt: '999@lid' },
    ]);

    expect(group('5491123456789@s.whatsapp.net')).toEqual([
      '111@lid',
      '541123456789@s.whatsapp.net',
      '5491123456789@s.whatsapp.net',
      '999@lid',
    ]);
    expect(rows.size).toBe(4);
  });

  it('saves 2,500 items with a bounded number of queries', async () => {
    const items = Array.from({ length: 2500 }, (_, index) => ({ remoteJid: `1555${index}@s.whatsapp.net` }));

    await saveOnWhatsappCache(items);

    expect(rows.size).toBe(2500);
    expect(isOnWhatsappJid.findMany.mock.calls.length).toBeLessThanOrEqual(10);
    expect(transaction).toHaveBeenCalledTimes(5);
    expect(isOnWhatsappJid.createMany).toHaveBeenCalledTimes(5);
  });

  it('reads whole existing groups with two queries per chunk', async () => {
    seed('15551234567@s.whatsapp.net', ['15551234567@s.whatsapp.net', '888@lid']);
    const items = Array.from({ length: 1000 }, (_, index) => ({ remoteJid: `1555${index}@s.whatsapp.net` }));
    items[700] = { remoteJid: '888@lid' };

    await saveOnWhatsappCache(items);

    expect(isOnWhatsappJid.findMany).toHaveBeenCalledTimes(3);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(group('888@lid')).toEqual(['15551234567@s.whatsapp.net', '888@lid']);
  });

  it('retries a chunk once when a concurrent writer causes a unique violation', async () => {
    transaction.mockRejectedValueOnce(uniqueViolation());

    await saveOnWhatsappCache([{ remoteJid: '15551234567@s.whatsapp.net' }]);

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(group('15551234567@s.whatsapp.net')).toEqual(['15551234567@s.whatsapp.net']);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs other errors and keeps processing the next chunk', async () => {
    transaction.mockRejectedValueOnce(new Error('database unavailable'));
    const items = Array.from({ length: 600 }, (_, index) => ({ remoteJid: `1555${index}@s.whatsapp.net` }));

    await expect(saveOnWhatsappCache(items)).resolves.toBeUndefined();

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(rows.size).toBe(100);
    expect(logger.error).toHaveBeenCalled();
  });

  it('keeps saving the rest of the batch when it contains empty items', async () => {
    const items = Array.from({ length: 30 }, (_, index) =>
      index < 10 ? undefined : { remoteJid: `1555000${index}@s.whatsapp.net` },
    );

    await saveOnWhatsappCache(items as any);

    expect(rows.size).toBe(20);
  });

  it('keeps every alternate jid when concurrent saves touch the same contact', async () => {
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    transaction.mockImplementation(async (operations: ReturnType<typeof lazy>[]) => {
      const results = [];
      for (const operation of operations) {
        await tick();
        results.push(await operation.run());
      }
      return results;
    });
    const contact = '5491123456789@s.whatsapp.net';

    await Promise.all(
      ['111@lid', '222@lid', '333@lid'].map((alt) => saveOnWhatsappCache([{ remoteJid: contact, remoteJidAlt: alt }])),
    );

    expect(logger.error).not.toHaveBeenCalled();
    expect(
      [...rows.values()]
        .filter((row) => row.jid.endsWith('@lid'))
        .map((row) => `${row.jid}>${row.remoteJid}`)
        .sort(),
    ).toEqual([`111@lid>${contact}`, `222@lid>${contact}`, `333@lid>${contact}`]);
  });
});
