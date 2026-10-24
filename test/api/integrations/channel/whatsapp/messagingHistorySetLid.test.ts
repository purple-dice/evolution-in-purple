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

const buildService = () => {
  const store = new Map<string, unknown>();
  const baileysCache = {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
  const config: Record<string, unknown> = {
    LOG: { BAILEYS: 'error' },
    DATABASE: { SAVE_DATA: { NEW_MESSAGE: true, HISTORIC: true, MESSAGE_UPDATE: true, CHATS: false, CONTACTS: false } },
    CHATWOOT: { ENABLED: false },
    OPENAI: { ENABLED: false },
    S3: { ENABLE: false },
  };
  const configService = { get: vi.fn((key: string) => config[key]) } as any;
  const prismaRepository = {
    chat: { findMany: vi.fn(async () => []), createMany: vi.fn(async () => ({})) },
    message: { createMany: vi.fn(async () => ({})), findMany: vi.fn(async () => []) },
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
  service.contactHandle = { 'contacts.upsert': vi.fn(async () => undefined) };
  const getPNsForLIDs = vi.fn(async () => [{ lid: '111@lid', pn: '5491111111111@s.whatsapp.net' }]);
  service.client = { signalRepository: { lidMapping: { getPNsForLIDs } } };
  return { service, prismaRepository, getPNsForLIDs };
};

describe('messaging-history.set with @lid messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists and emits history messages with remoteJidAlt resolved and remoteJid preserved', async () => {
    const { service, prismaRepository, getPNsForLIDs } = buildService();

    await service.messageHandle['messaging-history.set']({
      chats: [{ id: '111@lid' }],
      contacts: [],
      messages: [
        {
          key: { id: 'HIST-1', remoteJid: '111@lid', fromMe: false },
          message: { conversation: 'hi' },
          messageTimestamp: 1700000000,
          pushName: 'Someone',
        },
      ],
    });

    expect(getPNsForLIDs).toHaveBeenCalledWith(['111@lid']);
    const [{ data }] = prismaRepository.message.createMany.mock.calls[0];
    expect(data[0].key).toMatchObject({ remoteJid: '111@lid', remoteJidAlt: '5491111111111@s.whatsapp.net' });
    const [, emitted] = service.sendDataWebhook.mock.calls.find(([event]) => event === Events.MESSAGES_SET);
    expect(emitted[0].key.remoteJidAlt).toBe('5491111111111@s.whatsapp.net');
    expect(prismaRepository.chat.createMany.mock.calls[0][0].data[0].remoteJid).toBe('111@lid');
  });
});
