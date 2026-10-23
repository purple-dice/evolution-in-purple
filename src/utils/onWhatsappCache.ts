import { prismaRepository } from '@api/server.module';
import { configService, Database } from '@config/env.config';
import { Logger } from '@config/logger.config';
import dayjs from 'dayjs';

const logger = new Logger('OnWhatsappCache');

function getAvailableNumbers(remoteJid: string) {
  const numbersAvailable: string[] = [];

  if (remoteJid.startsWith('+')) {
    remoteJid = remoteJid.slice(1);
  }

  const [number, domain = 's.whatsapp.net'] = remoteJid.split('@');

  if (domain === 'lid' || domain === 'g.us') {
    return [remoteJid];
  }

  if (remoteJid.startsWith('55')) {
    const numberWithDigit =
      number.slice(4, 5) === '9' && number.length === 13 ? number : `${number.slice(0, 4)}9${number.slice(4)}`;
    const numberWithoutDigit = number.length === 12 ? number : number.slice(0, 4) + number.slice(5);

    numbersAvailable.push(numberWithDigit);
    numbersAvailable.push(numberWithoutDigit);
  } else if (number.startsWith('52') || number.startsWith('54')) {
    let prefix = '';
    if (number.startsWith('52')) {
      prefix = '1';
    }
    if (number.startsWith('54')) {
      prefix = '9';
    }

    const numberWithDigit =
      number.slice(2, 3) === prefix && number.length === 13
        ? number
        : `${number.slice(0, 2)}${prefix}${number.slice(2)}`;
    const numberWithoutDigit = number.length === 12 ? number : number.slice(0, 2) + number.slice(3);

    numbersAvailable.push(numberWithDigit);
    numbersAvailable.push(numberWithoutDigit);
  } else {
    numbersAvailable.push(number);
  }

  return numbersAvailable.map((number) => `${number}@${domain}`);
}

interface ISaveOnWhatsappCacheParams {
  remoteJid: string;
  remoteJidAlt?: string;
  lid?: 'lid' | undefined;
}

interface CacheGroup {
  remoteJid: string;
  jids: Set<string>;
  lid: string | null;
}

interface NormalizedItem {
  remoteJid: string;
  jids: string[];
  lid: string | null;
}

const SAVE_CHUNK_SIZE = 500;

function normalizeJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  return jid.startsWith('+') ? jid.slice(1) : jid;
}

function normalizeItem(item: ISaveOnWhatsappCacheParams | undefined): NormalizedItem | null {
  const remoteJid = normalizeJid(item?.remoteJid);
  if (!remoteJid) {
    logger.warn('[saveOnWhatsappCache] Item skipped, missing remoteJid.');
    return null;
  }

  const altJid = normalizeJid(item.remoteJidAlt);
  const baseJids = altJid && altJid.includes('@lid') ? [remoteJid, altJid] : [remoteJid];

  return {
    remoteJid,
    jids: [...new Set(baseJids.flatMap((jid) => getAvailableNumbers(jid)))],
    lid: item.lid === 'lid' || item.remoteJid.includes('@lid') ? 'lid' : null,
  };
}

async function loadExistingGroups(jids: string[]) {
  const groups = new Map<string, CacheGroup>();
  const hits = await prismaRepository.isOnWhatsappJid.findMany({ where: { jid: { in: jids } } });
  const canonicals = [...new Set(hits.map((row) => row.remoteJid))];
  if (canonicals.length === 0) return groups;

  const rows = await prismaRepository.isOnWhatsappJid.findMany({ where: { remoteJid: { in: canonicals } } });
  for (const row of [...hits, ...rows]) {
    const group = groups.get(row.remoteJid) ?? { remoteJid: row.remoteJid, jids: new Set<string>(), lid: null };
    group.jids.add(row.jid);
    group.lid = group.lid ?? row.lid ?? null;
    groups.set(row.remoteJid, group);
  }
  return groups;
}

function mergeGroups(items: NormalizedItem[], existing: Map<string, CacheGroup>) {
  const existingByJid = new Map<string, CacheGroup>();
  existing.forEach((group) => group.jids.forEach((jid) => existingByJid.set(jid, group)));

  const builtByJid = new Map<string, CacheGroup>();
  for (const item of items) {
    const group: CacheGroup = { remoteJid: item.remoteJid, jids: new Set(item.jids), lid: item.lid };

    for (const jid of item.jids) {
      const found = existingByJid.get(jid);
      if (!found) continue;
      found.jids.forEach((existingJid) => group.jids.add(existingJid));
      group.lid = group.lid ?? found.lid;
    }

    const previous = new Set([...group.jids].map((jid) => builtByJid.get(jid)).filter(Boolean));
    for (const earlier of previous) {
      earlier.jids.forEach((jid) => group.jids.add(jid));
      group.lid = group.lid ?? earlier.lid;
    }

    group.jids.forEach((jid) => builtByJid.set(jid, group));
  }

  return new Set(builtByJid.values());
}

async function saveChunk(items: NormalizedItem[]) {
  const variants = [...new Set(items.flatMap((item) => item.jids))];
  const groups = mergeGroups(items, await loadExistingGroups(variants));

  const rows = new Map<string, { jid: string; remoteJid: string; lid: string | null }>();
  groups.forEach((group) =>
    group.jids.forEach((jid) => rows.set(jid, { jid, remoteJid: group.remoteJid, lid: group.lid })),
  );
  const jids = [...rows.keys()];

  logger.verbose(`[saveOnWhatsappCache] Saving ${jids.length} jids in ${groups.size} groups`);

  await prismaRepository.$transaction([
    prismaRepository.isOnWhatsappJid.deleteMany({ where: { jid: { in: jids } } }),
    prismaRepository.isOnWhatsappJid.createMany({ data: [...rows.values()] }),
  ]);
}

const writeQueue: { tail: Promise<unknown> } = { tail: Promise.resolve() };

function enqueueWrite<T>(write: () => Promise<T>): Promise<T> {
  const run = writeQueue.tail.then(write);
  writeQueue.tail = run.catch(() => undefined);
  return run;
}

export async function saveOnWhatsappCache(data: ISaveOnWhatsappCacheParams[]) {
  if (!configService.get<Database>('DATABASE').SAVE_DATA.IS_ON_WHATSAPP) {
    return;
  }

  const items = data.map(normalizeItem).filter((item): item is NormalizedItem => item !== null);
  await enqueueWrite(() => saveItems(items));
}

async function saveChunkWithRetry(chunk: NormalizedItem[]) {
  try {
    await saveChunk(chunk);
  } catch (error) {
    if ((error as { code?: string })?.code !== 'P2002') throw error;
    await saveChunk(chunk);
  }
}

async function saveItems(items: NormalizedItem[]) {
  const chunks = Array.from({ length: Math.ceil(items.length / SAVE_CHUNK_SIZE) }, (_, index) =>
    items.slice(index * SAVE_CHUNK_SIZE, (index + 1) * SAVE_CHUNK_SIZE),
  );

  for (const [index, chunk] of chunks.entries()) {
    try {
      await saveChunkWithRetry(chunk);
    } catch (error) {
      logger.error(`[saveOnWhatsappCache] Error saving chunk starting at item ${index * SAVE_CHUNK_SIZE}: `);
      logger.error(error);
    }
  }
}

export async function getOnWhatsappCache(remoteJids: string[]) {
  const results: {
    remoteJid: string;
    number: string;
    jidOptions: string[];
    lid?: string;
  }[] = [];

  if (!configService.get<Database>('DATABASE').SAVE_DATA.IS_ON_WHATSAPP) {
    return results;
  }

  const cutoff = dayjs()
    .subtract(configService.get<Database>('DATABASE').SAVE_DATA.IS_ON_WHATSAPP_DAYS, 'days')
    .toDate();
  const variants = [...new Set(remoteJids.flatMap((remoteJid) => getAvailableNumbers(remoteJid)))];

  const hits = await prismaRepository.isOnWhatsappJid.findMany({
    where: { jid: { in: variants }, updatedAt: { gte: cutoff } },
  });
  const canonicals = [...new Set(hits.map((row) => row.remoteJid))];
  if (canonicals.length === 0) {
    return results;
  }

  const rows = await prismaRepository.isOnWhatsappJid.findMany({
    where: { remoteJid: { in: canonicals }, updatedAt: { gte: cutoff } },
  });

  const groups = new Map<string, { jids: Set<string>; lid?: string }>();
  for (const row of rows) {
    const group = groups.get(row.remoteJid) ?? { jids: new Set<string>() };
    group.jids.add(row.jid);
    group.lid = group.lid ?? row.lid ?? undefined;
    groups.set(row.remoteJid, group);
  }

  groups.forEach((group, remoteJid) =>
    results.push({
      remoteJid,
      number: remoteJid.split('@')[0],
      jidOptions: [...group.jids].sort(),
      lid: group.lid,
    }),
  );

  return results;
}
