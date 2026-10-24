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

const remoteJid = '5492615550101@s.whatsapp.net';

const runRevoke = async () => {
  const { service, prismaRepository } = buildService();
  prismaRepository.$queryRaw = vi.fn(async () => [
    { id: 'row-MSG-1', key: { id: 'MSG-1', remoteJid, fromMe: false }, status: 'DELIVERY_ACK' },
  ]);
  await service.messageHandle['messages.update'](
    [{ key: { id: 'MSG-1', fromMe: false, remoteJid }, update: { message: null } }],
    {},
  );
  return { service, prismaRepository };
};

describe('messages.update revoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records the revoke as a DELETED message update', async () => {
    const { prismaRepository } = await runRevoke();

    expect(prismaRepository.messageUpdate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        keyId: 'MSG-1',
        messageId: 'row-MSG-1',
        status: 'DELETED',
        instanceId: 'instance-id',
      }),
    });
  });

  it('marks the stored message row as DELETED', async () => {
    const { prismaRepository } = await runRevoke();

    expect(prismaRepository.message.update).toHaveBeenCalledWith({
      where: { id: 'row-MSG-1' },
      data: { status: 'DELETED' },
    });
  });

  it('keeps the MESSAGES_DELETE webhook payload unchanged', async () => {
    const { service } = await runRevoke();

    const deleteWebhooks = service.sendDataWebhook.mock.calls.filter(([event]) => event === Events.MESSAGES_DELETE);
    expect(deleteWebhooks).toEqual([
      [Events.MESSAGES_DELETE, { id: 'MSG-1', fromMe: false, remoteJid, status: 'DELETED' }],
    ]);
  });
});
