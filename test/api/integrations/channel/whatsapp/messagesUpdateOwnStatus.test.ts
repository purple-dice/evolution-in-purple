import { BaileysStartupService } from '@api/integrations/channel/whatsapp/whatsapp.baileys.service';
import { Events } from '@api/types/wa.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@api/server.module', () => ({
  chatbotController: { emit: vi.fn(async () => undefined) },
  waMonitor: {},
}));

vi.mock('@utils/onWhatsappCache', () => ({
  getOnWhatsappCache: vi.fn(async () => []),
  saveOnWhatsappCache: vi.fn(async () => undefined),
}));

vi.mock('@utils/sendTelemetry', () => ({ sendTelemetry: vi.fn() }));

vi.mock('@api/integrations/chatbot/chatwoot/utils/chatwoot-import-helper', () => ({
  chatwootImport: { getRepositoryMessagesCache: vi.fn(() => null), setRepositoryMessagesCache: vi.fn() },
}));

const buildCache = () => {
  const store = new Map<string, unknown>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
};

const buildService = (baileysCache = buildCache()) => {
  const config: Record<string, unknown> = {
    LOG: { BAILEYS: 'error' },
    DATABASE: { SAVE_DATA: { NEW_MESSAGE: true, HISTORIC: true, MESSAGE_UPDATE: true, CHATS: false, CONTACTS: false } },
    CHATWOOT: { ENABLED: false },
    OPENAI: { ENABLED: false },
    S3: { ENABLE: false },
  };
  const configService = { get: vi.fn((key: string) => config[key]) } as any;
  const prismaRepository = {
    chat: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []), createMany: vi.fn(async () => ({})) },
    message: {
      create: vi.fn(async ({ data }) => ({ id: 'row-id', ...data })),
      createMany: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    messageUpdate: { create: vi.fn(async () => ({})) },
    contact: { findFirst: vi.fn(async () => null) },
  } as any;
  const service = new BaileysStartupService(
    configService,
    { emit: vi.fn() } as any,
    prismaRepository,
    {} as any,
    {} as any,
    baileysCache as any,
    {} as any,
  ) as any;
  service.instance.id = 'instance-id';
  service.instance.name = 'instance-name';
  service.sendDataWebhook = vi.fn();
  service.profilePicture = vi.fn(async () => ({ profilePictureUrl: null }));
  service.updateMessagesReadedByTimestamp = vi.fn(async () => undefined);
  service.updateChatUnreadMessages = vi.fn(async () => undefined);
  service.client = { readMessages: vi.fn() };
  service.contactHandle = { 'contacts.upsert': vi.fn(async () => undefined) };
  return { service, prismaRepository, baileysCache };
};

const storedMessage = (id: string, fromMe: boolean, status: string) => ({
  id: `row-${id}`,
  key: { id, remoteJid: '5491111111111@s.whatsapp.net', fromMe },
  status,
  messageTimestamp: 1700000000,
});

const updateWebhooks = (service: any) =>
  service.sendDataWebhook.mock.calls.filter(([event]) => event === Events.MESSAGES_UPDATE).map(([, data]) => data);

const runUpdate = async (fromMe: boolean, storedStatus: string, incomingStatus: number, remoteJid?: string) => {
  const { service, prismaRepository } = buildService();
  prismaRepository.$queryRaw = vi.fn(async () => [storedMessage('MSG-1', fromMe, storedStatus)]);
  await service.messageHandle['messages.update'](
    [{ key: { id: 'MSG-1', fromMe, remoteJid }, update: { status: incomingStatus } }],
    {},
  );
  return { service, prismaRepository };
};

describe('messages.update status of own messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes the ack status of a sent message by row id', async () => {
    const { prismaRepository } = await runUpdate(true, 'PENDING', 3, '5491111111111@s.whatsapp.net');

    expect(prismaRepository.message.updateMany).toHaveBeenCalledWith({
      where: { id: 'row-MSG-1', OR: [{ status: null }, { status: { in: ['ERROR', 'PENDING', 'SERVER_ACK'] } }] },
      data: { status: 'DELIVERY_ACK' },
    });
  });

  it('writes the ack status of a sent message without a remote jid in the key', async () => {
    const { prismaRepository } = await runUpdate(true, 'SERVER_ACK', 4);

    expect(prismaRepository.message.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'row-MSG-1',
        OR: [{ status: null }, { status: { in: ['ERROR', 'PENDING', 'SERVER_ACK', 'DELIVERY_ACK'] } }],
      },
      data: { status: 'READ' },
    });
  });

  it('skips a backward ack but still emits the webhook and records the update', async () => {
    const { service, prismaRepository } = await runUpdate(true, 'READ', 3, '5491111111111@s.whatsapp.net');

    expect(prismaRepository.message.updateMany).not.toHaveBeenCalled();
    expect(updateWebhooks(service)).toHaveLength(1);
    expect(updateWebhooks(service)[0]).not.toHaveProperty('key');
    expect(prismaRepository.messageUpdate.create).toHaveBeenCalledTimes(1);
  });

  it('still emits the webhook and records the update when the status write fails', async () => {
    const { service, prismaRepository } = buildService();
    prismaRepository.$queryRaw = vi.fn(async () => [storedMessage('MSG-1', true, 'PENDING')]);
    prismaRepository.message.updateMany = vi.fn(async () => {
      throw new Error('db down');
    });

    await service.messageHandle['messages.update'](
      [{ key: { id: 'MSG-1', fromMe: true, remoteJid: '5491111111111@s.whatsapp.net' }, update: { status: 3 } }],
      {},
    );

    expect(updateWebhooks(service)).toHaveLength(1);
    expect(prismaRepository.messageUpdate.create).toHaveBeenCalledTimes(1);
  });

  it('keeps the received message path marking the chat as read', async () => {
    const { service, prismaRepository } = await runUpdate(false, 'DELIVERY_ACK', 4, '5491111111111@s.whatsapp.net');

    expect(service.updateMessagesReadedByTimestamp).toHaveBeenCalledWith('5491111111111@s.whatsapp.net', 1700000000);
    expect(prismaRepository.message.update).toHaveBeenCalledWith({
      where: { id: 'row-MSG-1' },
      data: { status: 'READ' },
    });
    expect(prismaRepository.message.updateMany).not.toHaveBeenCalled();
    expect(prismaRepository.messageUpdate.create).toHaveBeenCalledTimes(1);
  });
});
