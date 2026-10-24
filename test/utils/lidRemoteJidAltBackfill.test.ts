import { LidRemoteJidAltBackfill } from '@utils/lidRemoteJidAltBackfill';
import { describe, expect, it, vi } from 'vitest';

const LID = '100000000000001@lid';
const PHONE = '5492615550102@s.whatsapp.net';

function makeBackfill(executeRaw = vi.fn().mockResolvedValue(3)) {
  const prisma = { $executeRaw: executeRaw } as any;
  const logger = { warn: vi.fn(), verbose: vi.fn() } as any;
  return { backfill: new LidRemoteJidAltBackfill(prisma, logger), executeRaw, logger };
}

describe('LidRemoteJidAltBackfill', () => {
  it('backfills stored messages when a LID->phone pair is learned', async () => {
    const { backfill, executeRaw } = makeBackfill();
    await backfill.schedule('instance-1', LID, PHONE);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('updates only this instance rows for the lid with bound parameters', async () => {
    const { backfill, executeRaw } = makeBackfill();
    await backfill.schedule('instance-1', LID, PHONE);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = executeRaw.mock.calls[0];
    const sql = strings.join('?');
    expect(sql).toContain('jsonb_set');
    expect(sql).toContain('"instanceId" = ?');
    expect(sql).not.toContain(LID);
    expect(sql).not.toContain(PHONE);
    expect(values).toEqual(expect.arrayContaining(['instance-1', LID, PHONE]));
  });

  it('normalizes device suffixes before backfilling', async () => {
    const { backfill, executeRaw } = makeBackfill();
    await backfill.schedule('instance-1', '100000000000001:12@lid', '5492615550102:3@s.whatsapp.net');
    const values = executeRaw.mock.calls[0].slice(1);
    expect(values).toEqual(expect.arrayContaining([LID, PHONE]));
  });

  it('runs at most once per instance and lid', async () => {
    const { backfill, executeRaw } = makeBackfill();
    await backfill.schedule('instance-1', LID, PHONE);
    expect(backfill.schedule('instance-1', LID, PHONE)).toBeUndefined();
    await backfill.schedule('instance-2', LID, PHONE);
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['missing lid', undefined, PHONE],
    ['missing phone', LID, undefined],
    ['phone that is not a user JID', LID, '123@lid'],
    ['lid that is not a lid', '5492615550102@s.whatsapp.net', PHONE],
    ['group participant', '120363000000000000@g.us', PHONE],
  ])('skips a %s', (_label, lid, phone) => {
    const { backfill, executeRaw } = makeBackfill();
    expect(backfill.schedule('instance-1', lid, phone)).toBeUndefined();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('logs a warning and resolves when the update fails', async () => {
    const { backfill, logger } = makeBackfill(vi.fn().mockRejectedValue(new Error('db down')));
    await expect(backfill.schedule('instance-1', LID, PHONE)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('retries a lid whose previous update failed', async () => {
    const executeRaw = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(1);
    const { backfill } = makeBackfill(executeRaw);
    await backfill.schedule('instance-1', LID, PHONE);
    await backfill.schedule('instance-1', LID, PHONE);
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it('runs one update at a time and keeps going after a failure', async () => {
    let running = 0;
    let maxRunning = 0;
    const executeRaw = vi.fn().mockImplementation(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      if (executeRaw.mock.calls.length === 1) throw new Error('db down');
      return 1;
    });
    const { backfill } = makeBackfill(executeRaw);
    await Promise.all([
      backfill.schedule('instance-1', LID, PHONE),
      backfill.schedule('instance-1', '1@lid', PHONE),
      backfill.schedule('instance-1', '2@lid', PHONE),
    ]);
    expect(executeRaw).toHaveBeenCalledTimes(3);
    expect(maxRunning).toBe(1);
  });

  it('clears the dedupe set once it grows past its bound', async () => {
    const { backfill, executeRaw } = makeBackfill();
    await backfill.schedule('instance-1', LID, PHONE);
    for (let index = 0; index <= 10_000; index++) {
      backfill.schedule('instance-1', `${index}@lid`, PHONE);
    }
    await backfill.schedule('instance-1', LID, PHONE);
    expect(executeRaw.mock.calls.filter((call) => call.includes(LID))).toHaveLength(2);
  });
});
