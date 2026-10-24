import { resolvePhoneRemoteJid } from '@utils/resolvePhoneRemoteJid';
import { describe, expect, it } from 'vitest';

describe('resolvePhoneRemoteJid', () => {
  it('replaces a @lid remoteJid with the phone JID from remoteJidAlt', () => {
    expect(
      resolvePhoneRemoteJid({ remoteJid: '100000000000001@lid', remoteJidAlt: '5492615550102@s.whatsapp.net' }),
    ).toBe('5492615550102@s.whatsapp.net');
  });

  it('keeps a @lid remoteJid when remoteJidAlt is missing', () => {
    expect(resolvePhoneRemoteJid({ remoteJid: '100000000000001@lid' })).toBe('100000000000001@lid');
  });

  it('keeps a @lid remoteJid when remoteJidAlt is empty', () => {
    expect(resolvePhoneRemoteJid({ remoteJid: '100000000000001@lid', remoteJidAlt: '' })).toBe('100000000000001@lid');
  });

  it('keeps a phone remoteJid even when remoteJidAlt is present', () => {
    expect(
      resolvePhoneRemoteJid({ remoteJid: '5492615550102@s.whatsapp.net', remoteJidAlt: '100000000000001@lid' }),
    ).toBe('5492615550102@s.whatsapp.net');
  });

  it('keeps a group remoteJid', () => {
    expect(resolvePhoneRemoteJid({ remoteJid: '120363204608479348@g.us', remoteJidAlt: undefined })).toBe(
      '120363204608479348@g.us',
    );
  });

  it('KNOWN BUG: replaces a remoteJid that contains @lid outside the suffix (current behavior)', () => {
    expect(resolvePhoneRemoteJid({ remoteJid: 'x@lid.example', remoteJidAlt: '5492615550102@s.whatsapp.net' })).toBe(
      '5492615550102@s.whatsapp.net',
    );
  });

  it.fails('keeps a remoteJid that contains @lid outside the suffix', () => {
    expect(resolvePhoneRemoteJid({ remoteJid: 'x@lid.example', remoteJidAlt: '5492615550102@s.whatsapp.net' })).toBe(
      'x@lid.example',
    );
  });

  it('returns undefined when there is no remoteJid', () => {
    expect(resolvePhoneRemoteJid({ remoteJidAlt: '5492615550102@s.whatsapp.net' })).toBeUndefined();
  });
});
