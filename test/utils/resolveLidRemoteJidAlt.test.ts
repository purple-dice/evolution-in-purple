import { resolveLidRemoteJidAlt } from '@utils/resolveLidRemoteJidAlt';
import { describe, expect, it, vi } from 'vitest';

const message = (remoteJid: string, remoteJidAlt?: string) =>
  ({ key: { id: `id-${remoteJid}`, remoteJid, fromMe: false, ...(remoteJidAlt ? { remoteJidAlt } : {}) } }) as any;

describe('resolveLidRemoteJidAlt', () => {
  it('fills remoteJidAlt from a payload contact carrying lid and phone number', async () => {
    const messages = [message('111@lid')];
    const lookup = vi.fn(async () => []);

    await resolveLidRemoteJidAlt(messages, [{ id: '111@lid', phoneNumber: '5491111111111@s.whatsapp.net' }], lookup);

    expect(messages[0].key).toMatchObject({ remoteJid: '111@lid', remoteJidAlt: '5491111111111@s.whatsapp.net' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('replaces a remoteJidAlt that is not a phone jid', async () => {
    const messages = [message('555@lid', '555@lid')];

    await resolveLidRemoteJidAlt(messages, [{ id: '555@lid', phoneNumber: '5495555555555@s.whatsapp.net' }]);

    expect(messages[0].key).toMatchObject({ remoteJid: '555@lid', remoteJidAlt: '5495555555555@s.whatsapp.net' });
  });

  it('fills remoteJidAlt from a contact whose id is the phone jid and lid is set', async () => {
    const messages = [message('222@lid')];

    await resolveLidRemoteJidAlt(messages, [{ id: '5492222222222@s.whatsapp.net', lid: '222@lid' }]);

    expect(messages[0].key.remoteJidAlt).toBe('5492222222222@s.whatsapp.net');
  });

  it('looks up the remaining distinct lids once and normalizes the phone jid', async () => {
    const messages = [message('333@lid'), message('333@lid'), message('444@lid')];
    const lookup = vi.fn(async () => [
      { lid: '333@lid', pn: '5493333333333:12@s.whatsapp.net' },
      { lid: '444@lid', pn: '5494444444444@s.whatsapp.net' },
    ]);

    await resolveLidRemoteJidAlt(messages, [], lookup);

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(['333@lid', '444@lid']);
    expect(messages.map((m) => m.key.remoteJidAlt)).toEqual([
      '5493333333333@s.whatsapp.net',
      '5493333333333@s.whatsapp.net',
      '5494444444444@s.whatsapp.net',
    ]);
  });

  it('leaves remoteJid untouched and skips groups, phone jids and already resolved messages', async () => {
    const messages = [
      message('555@lid', '5495555555555@s.whatsapp.net'),
      message('123@g.us'),
      message('5496666666666@s.whatsapp.net'),
    ];
    const lookup = vi.fn(async () => [{ lid: '555@lid', pn: '5490000000000@s.whatsapp.net' }]);

    await resolveLidRemoteJidAlt(messages, [], lookup);

    expect(lookup).not.toHaveBeenCalled();
    expect(messages.map((m) => [m.key.remoteJid, m.key.remoteJidAlt])).toEqual([
      ['555@lid', '5495555555555@s.whatsapp.net'],
      ['123@g.us', undefined],
      ['5496666666666@s.whatsapp.net', undefined],
    ]);
  });

  it('ignores lookup results that are not phone jids', async () => {
    const messages = [message('777@lid')];

    await resolveLidRemoteJidAlt(messages, [], async () => [{ lid: '777@lid', pn: '888@lid' }]);

    expect(messages[0].key.remoteJidAlt).toBeUndefined();
  });

  it('reports lookup failures without throwing', async () => {
    const messages = [message('999@lid')];
    const onLookupError = vi.fn();

    await expect(
      resolveLidRemoteJidAlt(
        messages,
        [],
        async () => {
          throw new Error('boom');
        },
        onLookupError,
      ),
    ).resolves.toBeUndefined();

    expect(onLookupError).toHaveBeenCalledTimes(1);
    expect(messages[0].key.remoteJidAlt).toBeUndefined();
  });
});
