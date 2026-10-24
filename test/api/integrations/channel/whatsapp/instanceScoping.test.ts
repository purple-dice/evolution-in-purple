import { BaileysStartupService } from '@api/integrations/channel/whatsapp/whatsapp.baileys.service';
import { describe, expect, it, vi } from 'vitest';

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

const remoteJid = '5492615550101@s.whatsapp.net';

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
    chat: { findFirst: vi.fn(async () => null), update: vi.fn(async () => ({})) },
    message: { findFirst: vi.fn(async () => null), update: vi.fn(async ({ data }) => ({ id: 'row-id', ...data })) },
    messageUpdate: { create: vi.fn(async () => ({})) },
    $queryRaw: vi.fn(async () => [{ count: 0 }]),
  } as any;
  const service = new BaileysStartupService(
    configService,
    { emit: vi.fn() } as any,
    prismaRepository,
    {} as any,
    {} as any,
    { get: vi.fn(), set: vi.fn() } as any,
    {} as any,
  ) as any;
  service.instance.id = 'instance-id';
  service.instance.name = 'instance-name';
  service.sendDataWebhook = vi.fn();
  return { service, prismaRepository };
};

describe('updateChatUnreadMessages instance scoping', () => {
  it('looks up the chat within the current instance', async () => {
    const { service, prismaRepository } = buildService();

    await service.updateChatUnreadMessages(remoteJid);

    expect(prismaRepository.chat.findFirst).toHaveBeenCalledWith({
      where: { instanceId: 'instance-id', remoteJid },
    });
  });
});

describe('updateMessage instance scoping and guards', () => {
  const buildEdit = (storedKey: Record<string, unknown>) => {
    const { service, prismaRepository } = buildService();
    service.formatUpdateMessage = vi.fn(async () => ({ text: 'edited' }));
    service.getMessage = vi.fn(async () => ({
      key: { id: 'MSG-1', remoteJid, fromMe: true },
      messageType: 'conversation',
      message: { conversation: 'original' },
      messageTimestamp: 1,
    }));
    service.client = {
      sendMessage: vi.fn(async () => ({
        key: { id: 'EDIT-1', remoteJid, fromMe: true },
        message: { protocolMessage: { key: { id: 'MSG-1', remoteJid, fromMe: true } } },
      })),
    };
    prismaRepository.message.findFirst = vi.fn(async () => ({ id: 'row-MSG-1', key: storedKey }));
    const data = { number: '5492615550101', text: 'edited', key: { id: 'MSG-1', remoteJid, fromMe: true } };
    return { service, prismaRepository, data };
  };

  it('looks up the edited message within the current instance', async () => {
    const { service, prismaRepository, data } = buildEdit({ id: 'MSG-1', remoteJid, fromMe: true });

    await service.updateMessage(data);

    expect(prismaRepository.message.findFirst).toHaveBeenCalledWith({
      where: { instanceId: 'instance-id', key: { path: ['id'], equals: 'MSG-1' } },
    });
    expect(prismaRepository.message.update).toHaveBeenCalledTimes(1);
  });

  it('rejects editing a message not sent by the instance and does not update it', async () => {
    const { service, prismaRepository, data } = buildEdit({ id: 'MSG-1', remoteJid, fromMe: false });

    await expect(service.updateMessage(data)).rejects.toThrow('You cannot edit others messages');
    expect(prismaRepository.message.update).not.toHaveBeenCalled();
  });

  it('rejects editing a deleted message and does not update it', async () => {
    const { service, prismaRepository, data } = buildEdit({ id: 'MSG-1', remoteJid, fromMe: true, deleted: true });

    await expect(service.updateMessage(data)).rejects.toThrow('You cannot edit deleted messages');
    expect(prismaRepository.message.update).not.toHaveBeenCalled();
  });
});
