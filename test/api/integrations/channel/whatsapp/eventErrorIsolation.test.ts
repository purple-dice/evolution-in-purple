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
  service.sendDataWebhook = vi.fn();
  service.profilePicture = vi.fn(async () => ({ profilePictureUrl: null }));
  service.updateMessagesReadedByTimestamp = vi.fn(async () => undefined);
  service.updateChatUnreadMessages = vi.fn(async () => undefined);
  service.client = { readMessages: vi.fn() };
  service.contactHandle = { 'contacts.upsert': vi.fn(async () => undefined) };
  return { service, prismaRepository };
};

const remoteJid = '5492615550101@s.whatsapp.net';
const groupJid = '120363000000000001@g.us';

const message = (id: string) => ({
  key: { id, fromMe: false, remoteJid },
  message: { conversation: 'hello' },
  messageTimestamp: 1700000000,
  pushName: 'Someone',
});

const webhookCalls = (service: any, event: Events) =>
  service.sendDataWebhook.mock.calls.filter(([sent]) => sent === event);

const processEvents = async (service: any, events: Record<string, unknown>, settings: Record<string, unknown>) => {
  let processCallback: (events: Record<string, unknown>) => Promise<void>;
  service.client = {
    ev: {
      process: vi.fn((callback) => {
        processCallback = callback;
      }),
    },
  };
  service.findSettings = vi.fn(async () => settings);
  service.chatHandle = {
    'chats.upsert': vi.fn(async () => undefined),
    'chats.update': vi.fn(async () => undefined),
  };
  service.labelHandle = {
    [Events.LABELS_EDIT]: vi.fn(async () => undefined),
    [Events.LABELS_ASSOCIATION]: vi.fn(async () => undefined),
  };
  service.eventHandler();
  await processCallback(events);
  await service.eventProcessingQueue;
};

describe('event error isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits the remaining upserts of a batch when one message fails to store', async () => {
    const { service, prismaRepository } = buildService();
    prismaRepository.message.create
      .mockImplementationOnce(async ({ data }) => ({ id: 'row-1', ...data }))
      .mockRejectedValueOnce(new Error('database unavailable'));

    await service.messageHandle['messages.upsert'](
      { messages: [message('MSG-1'), message('MSG-2'), message('MSG-3')], type: 'notify' },
      {},
    );

    const emittedIds = webhookCalls(service, Events.MESSAGES_UPSERT).map(([, data]) => data.key.id);
    expect(emittedIds).toEqual(['MSG-1', 'MSG-3']);
  });

  it('handles the remaining updates of a batch when one update fails', async () => {
    const { service, prismaRepository } = buildService();
    prismaRepository.$queryRaw = vi
      .fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce([
        { id: 'row-MSG-2', key: { id: 'MSG-2', remoteJid, fromMe: false }, status: 'DELIVERY_ACK' },
      ]);

    await service.messageHandle['messages.update'](
      [
        { key: { id: 'MSG-1', fromMe: false, remoteJid }, update: { message: null } },
        { key: { id: 'MSG-2', fromMe: false, remoteJid }, update: { message: null } },
      ],
      {},
    );

    const deletedIds = webhookCalls(service, Events.MESSAGES_DELETE).map(([, data]) => data.id);
    expect(deletedIds).toEqual(['MSG-2']);
  });

  it('runs later event types after an ignored group presence update', async () => {
    const { service } = buildService();
    const chats = [{ id: remoteJid }];

    await processEvents(
      service,
      { 'presence.update': { id: groupJid, presences: {} }, 'chats.upsert': chats },
      { groupsIgnore: true },
    );

    expect(webhookCalls(service, Events.PRESENCE_UPDATE)).toHaveLength(0);
    expect(service.chatHandle['chats.upsert']).toHaveBeenCalledWith(chats);
  });

  it('runs the labels edit handler after a labels association', async () => {
    const { service } = buildService();
    const association = { type: 'add', association: { chatId: remoteJid, labelId: '1' } };
    const label = { id: '1', name: 'Lead' };

    await processEvents(service, { [Events.LABELS_ASSOCIATION]: association, [Events.LABELS_EDIT]: label }, {});

    expect(service.labelHandle[Events.LABELS_ASSOCIATION]).toHaveBeenCalled();
    expect(service.labelHandle[Events.LABELS_EDIT]).toHaveBeenCalledWith(label);
  });

  it('runs later event types when an earlier event type throws', async () => {
    const { service } = buildService();
    const label = { id: '1', name: 'Lead' };
    service.messageHandle['messages.update'] = vi.fn(async () => {
      throw new Error('update failed');
    });

    await processEvents(service, { 'messages.update': [], [Events.LABELS_EDIT]: label }, {});

    expect(service.labelHandle[Events.LABELS_EDIT]).toHaveBeenCalledWith(label);
  });
});
