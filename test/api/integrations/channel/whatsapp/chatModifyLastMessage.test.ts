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

const phoneNumber = '5492615550101';
const phoneJid = '5492615550101@s.whatsapp.net';
const lidJid = '123456789012345@lid';

const buildService = (storedMessages: unknown[]) => {
  const config: Record<string, unknown> = {
    LOG: { BAILEYS: 'error' },
    CHATWOOT: { ENABLED: false },
    OPENAI: { ENABLED: false },
    S3: { ENABLE: false },
  };
  const configService = { get: vi.fn((key: string) => config[key]) } as any;
  const prismaRepository = {
    message: { findMany: vi.fn(async () => storedMessages) },
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
  service.client = { chatModify: vi.fn(async () => undefined) };
  return { service, prismaRepository };
};

const storedMessage = (remoteJid: string) => ({
  key: { id: 'MSG-1', remoteJid, fromMe: false },
  messageTimestamp: 1700000000,
});

describe('archiveChat by chat number', () => {
  it('looks up the last message by the JSON remoteJid path of the normalized JID within the instance', async () => {
    const { service, prismaRepository } = buildService([storedMessage(phoneJid)]);

    await service.archiveChat({ chat: phoneNumber, archive: true });

    expect(prismaRepository.message.findMany).toHaveBeenCalledWith({
      where: { key: { path: ['remoteJid'], equals: phoneJid }, instanceId: 'instance-id' },
      orderBy: { messageTimestamp: 'desc' },
      take: 1,
    });
  });

  it('archives with the stored last message and keeps the response shape', async () => {
    const { service } = buildService([storedMessage(phoneJid)]);

    const response = await service.archiveChat({ chat: phoneNumber, archive: true });

    expect(service.client.chatModify).toHaveBeenCalledWith(
      { archive: true, lastMessages: [storedMessage(phoneJid)] },
      phoneJid,
    );
    expect(response).toEqual({ chatId: phoneNumber, archived: true });
  });

  it('preserves @lid addressing in the lookup and the chat modification', async () => {
    const { service, prismaRepository } = buildService([storedMessage(lidJid)]);

    await service.archiveChat({ chat: lidJid, archive: true });

    expect(prismaRepository.message.findMany.mock.calls[0][0].where.key).toEqual({
      path: ['remoteJid'],
      equals: lidJid,
    });
    expect(service.client.chatModify.mock.calls[0][1]).toBe(lidJid);
  });

  it('archives a chat without stored messages using an empty lastMessages list', async () => {
    const { service } = buildService([]);

    const response = await service.archiveChat({ chat: phoneNumber, archive: true });

    expect(service.client.chatModify).toHaveBeenCalledWith({ archive: true, lastMessages: [] }, phoneJid);
    expect(response).toEqual({ chatId: phoneNumber, archived: true });
  });
});

describe('archiveChat with an explicit lastMessage', () => {
  it('uses the provided message without querying storage and keeps the response shape', async () => {
    const { service, prismaRepository } = buildService([]);
    const lastMessage = storedMessage(phoneJid);

    const response = await service.archiveChat({ lastMessage, archive: true });

    expect(prismaRepository.message.findMany).not.toHaveBeenCalled();
    expect(service.client.chatModify).toHaveBeenCalledWith({ archive: true, lastMessages: [lastMessage] }, phoneJid);
    expect(response).toEqual({ chatId: phoneJid, archived: true });
  });

  it('fills a missing messageTimestamp with unix seconds', async () => {
    const { service } = buildService([]);
    const lastMessage = { key: { id: 'MSG-1', remoteJid: phoneJid, fromMe: false } } as any;
    const nowSeconds = Math.floor(Date.now() / 1000);

    await service.archiveChat({ lastMessage, archive: true });

    expect(lastMessage.messageTimestamp).toBeGreaterThanOrEqual(nowSeconds);
    expect(lastMessage.messageTimestamp).toBeLessThan(nowSeconds + 60);
  });
});

describe('markChatUnread by chat number', () => {
  it('looks up the last message by the JSON remoteJid path and marks the chat unread', async () => {
    const { service, prismaRepository } = buildService([storedMessage(phoneJid)]);

    const response = await service.markChatUnread({ chat: phoneNumber });

    expect(prismaRepository.message.findMany.mock.calls[0][0].where).toEqual({
      key: { path: ['remoteJid'], equals: phoneJid },
      instanceId: 'instance-id',
    });
    expect(service.client.chatModify).toHaveBeenCalledWith(
      { markRead: false, lastMessages: [storedMessage(phoneJid)] },
      phoneJid,
    );
    expect(response).toEqual({ chatId: phoneNumber, markedChatUnread: true });
  });

  it('still fails when the chat has no stored messages', async () => {
    const { service } = buildService([]);

    await expect(service.markChatUnread({ chat: phoneNumber })).rejects.toMatchObject({
      message: expect.anything(),
    });
    expect(service.client.chatModify).not.toHaveBeenCalled();
  });
});
