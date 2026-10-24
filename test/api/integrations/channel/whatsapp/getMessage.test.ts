import { BaileysStartupService } from '@api/integrations/channel/whatsapp/whatsapp.baileys.service';
import { describe, expect, it, vi } from 'vitest';

const buildService = (queryRaw: () => Promise<unknown>) => {
  const service = Object.create(BaileysStartupService.prototype) as any;
  service.instance = { id: 'instance-id', name: 'instance-name' };
  service.prismaRepository = { $queryRaw: vi.fn(queryRaw), messageUpdate: { findFirst: vi.fn(async () => null) } };
  service.logger = { verbose: vi.fn(), error: vi.fn() };
  return service;
};

const key = { id: 'MESSAGE-ID', remoteJid: '5491123456789@s.whatsapp.net', fromMe: true };

describe('BaileysStartupService.getMessage', () => {
  it('returns undefined for an unknown key so Baileys skips the retry resend', async () => {
    const service = buildService(async () => []);

    await expect(service.getMessage(key)).resolves.toBeUndefined();
    await expect(service.getMessage(key, true)).resolves.toBeUndefined();
  });

  it('returns undefined when the lookup fails', async () => {
    const service = buildService(async () => {
      throw new Error('database unavailable');
    });

    await expect(service.getMessage(key)).resolves.toBeUndefined();
    await expect(service.getMessage(key, true)).resolves.toBeUndefined();
  });

  it('returns the stored message content for a known key', async () => {
    const stored = { key, message: { conversation: 'hello' } };
    const service = buildService(async () => [stored]);

    await expect(service.getMessage(key)).resolves.toEqual({ conversation: 'hello' });
    await expect(service.getMessage(key, true)).resolves.toEqual(stored);
  });

  it('returns the poll secret for a stored poll creation', async () => {
    const pollCreationMessage = { name: 'poll', options: [{ optionName: 'a' }] };
    const service = buildService(async () => [
      { key, message: { pollCreationMessage, messageContextInfo: { messageSecret: 'c2VjcmV0' } } },
    ]);

    const result = await service.getMessage(key);

    expect(result.pollCreationMessage).toEqual(pollCreationMessage);
    expect(Buffer.from(result.messageContextInfo.messageSecret).toString()).toBe('secret');
  });
});

describe('BaileysStartupService.getMessage for deleted messages', () => {
  const buildDeletedAwareService = (rows: unknown[], deletedUpdate: unknown = null) => {
    const service = buildService(async () => rows);
    service.prismaRepository.messageUpdate.findFirst = vi.fn(async () => deletedUpdate);
    return service;
  };

  it('returns undefined for a row with status DELETED', async () => {
    const service = buildDeletedAwareService([{ key, status: 'DELETED', message: { conversation: 'secret' } }]);

    await expect(service.getMessage(key)).resolves.toBeUndefined();
  });

  it('returns undefined for a row whose key is flagged deleted', async () => {
    const service = buildDeletedAwareService([
      { key: { ...key, deleted: true }, status: 'SERVER_ACK', message: { conversation: 'secret' } },
    ]);

    await expect(service.getMessage(key)).resolves.toBeUndefined();
  });

  it('returns undefined when a DELETED update exists for the instance', async () => {
    const service = buildDeletedAwareService([{ key, status: 'SERVER_ACK', message: { conversation: 'secret' } }], {
      id: 'update-id',
    });

    await expect(service.getMessage(key)).resolves.toBeUndefined();
    expect(service.prismaRepository.messageUpdate.findFirst).toHaveBeenCalledWith({
      where: { instanceId: 'instance-id', keyId: 'MESSAGE-ID', status: 'DELETED' },
    });
  });

  it('keeps returning the full row of a deleted message', async () => {
    const stored = { key, status: 'DELETED', message: { conversation: 'secret' } };
    const service = buildDeletedAwareService([stored], { id: 'update-id' });

    await expect(service.getMessage(key, true)).resolves.toEqual(stored);
  });

  it('returns the content of a live message', async () => {
    const service = buildDeletedAwareService([{ key, status: 'READ', message: { conversation: 'hello' } }]);

    await expect(service.getMessage(key)).resolves.toEqual({ conversation: 'hello' });
  });
});
