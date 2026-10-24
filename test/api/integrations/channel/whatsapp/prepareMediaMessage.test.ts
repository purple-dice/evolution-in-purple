import { BaileysStartupService } from '@api/integrations/channel/whatsapp/whatsapp.baileys.service';
import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';

vi.mock('baileys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('baileys')>();
  return {
    ...actual,
    prepareWAMessageMedia: vi.fn(async (content: Record<string, unknown>) => ({
      [`${Object.keys(content)[0]}Message`]: {},
    })),
  };
});

vi.mock('axios', () => ({ default: { get: vi.fn() } }));

const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const buildService = () => {
  const service = Object.create(BaileysStartupService.prototype) as any;
  service.client = { waUploadToServer: vi.fn() };
  service.instance = { wuid: '5491100000000@s.whatsapp.net' };
  service.logger = { verbose: vi.fn(), error: vi.fn() };
  return service;
};

const preparedMimetype = async (mediaMessage: Record<string, unknown>) => {
  const prepared = await buildService().prepareMediaMessage(mediaMessage);
  return Object.values(prepared.message)[0] as { mimetype: unknown; fileName: unknown };
};

describe('BaileysStartupService.prepareMediaMessage mimetype', () => {
  it('keeps the downloaded content type when the file name has no extension', async () => {
    vi.mocked(axios.get).mockResolvedValue({ headers: { 'content-type': 'application/pdf' }, data: Buffer.from('x') });

    const media = await preparedMimetype({
      mediatype: 'document',
      media: 'https://files.example.com/report',
      fileName: 'report',
    });

    expect(media.mimetype).toBe('application/pdf');
    expect(media.fileName).toBe('report');
  });

  it('keeps image/jpeg for images whose file name has no extension', async () => {
    const media = await preparedMimetype({ mediatype: 'image', media: onePixelPng, fileName: 'logo' });

    expect(media.mimetype).toBe('image/jpeg');
  });

  it('still derives the mimetype from a file name extension', async () => {
    const media = await preparedMimetype({ mediatype: 'document', media: 'aGVsbG8=', fileName: 'notes.txt' });

    expect(media.mimetype).toBe('text/plain');
  });

  it('still maps application/mp4 file names to video/mp4', async () => {
    const media = await preparedMimetype({ mediatype: 'document', media: 'aGVsbG8=', fileName: 'clip.mp4' });

    expect(media.mimetype).toBe('video/mp4');
  });
});
