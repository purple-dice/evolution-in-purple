import { BaileysStartupService } from '@api/integrations/channel/whatsapp/whatsapp.baileys.service';
import { Events } from '@api/types/wa.types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('baileys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('baileys')>();
  return {
    ...actual,
    downloadMediaMessage: vi.fn(async () => Buffer.from('fictional-image-bytes')),
  };
});

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
const buildService = () => {
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
    $queryRaw: vi.fn(async () => []),
  } as any;
  const service = new BaileysStartupService(
    configService,
    { emit: vi.fn() } as any,
    prismaRepository,
    {} as any,
    {} as any,
    buildCache() as any,
    {} as any,
  ) as any;
  service.instance.id = 'instance-id';
  service.instance.name = 'instance-name';
  service.localWebhook = { enabled: true, webhookBase64: true };
  service.sendDataWebhook = vi.fn();
  service.profilePicture = vi.fn(async () => ({ profilePictureUrl: null }));
  service.updateMessagesReadedByTimestamp = vi.fn(async () => undefined);
  service.updateChatUnreadMessages = vi.fn(async () => undefined);
  service.client = { readMessages: vi.fn(), updateMediaMessage: vi.fn() };
  service.contactHandle = { 'contacts.upsert': vi.fn(async () => undefined) };
  return service;
};

const MEDIA_BASE64 = Buffer.from('fictional-image-bytes').toString('base64');

const imageMessage = {
  key: { id: 'MSG-IMG-1', fromMe: false, remoteJid: '5492615550101@s.whatsapp.net' },
  message: { imageMessage: { mimetype: 'image/jpeg', caption: 'photo', url: 'https://example.invalid/media' } },
  messageTimestamp: 1700000000,
  pushName: 'Someone',
};

const loggerCallArgs = (service: any) =>
  Object.values(service.logger)
    .filter((member: any) => typeof member === 'function' && 'mock' in member)
    .flatMap((spy: any) => spy.mock.calls.flat());

const serialize = (value: unknown) => (typeof value === 'string' ? value : (JSON.stringify(value) ?? ''));

describe('baileys message handlers do not dump payloads to console', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never calls console.log nor logs media base64 on messages.upsert and messages.update', async () => {
    const service = buildService();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    for (const level of ['log', 'info', 'warn', 'error', 'verbose', 'debug']) {
      vi.spyOn(service.logger, level).mockImplementation(() => undefined);
    }

    await service.messageHandle['messages.upsert']({ messages: [imageMessage], type: 'notify' }, {});
    await service.messageHandle['messages.update'](
      [{ key: { id: 'MSG-IMG-1', fromMe: false, remoteJid: '5492615550101@s.whatsapp.net' }, update: { status: 3 } }],
      {},
    );

    const upsertPayload = service.sendDataWebhook.mock.calls.find(([event]) => event === Events.MESSAGES_UPSERT)?.[1];
    expect(upsertPayload?.message?.base64).toBe(MEDIA_BASE64);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(loggerCallArgs(service).map(serialize).join('\n')).not.toContain(MEDIA_BASE64);
  });
});
