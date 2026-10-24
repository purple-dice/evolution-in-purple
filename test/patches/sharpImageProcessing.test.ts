import { BaileysStartupService } from '@api/integrations/channel/whatsapp/whatsapp.baileys.service';
import { extractImageThumb } from 'baileys';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

vi.mock('baileys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('baileys')>();
  return {
    ...actual,
    prepareWAMessageMedia: vi.fn(async (content: Record<string, unknown>) => ({
      [`${Object.keys(content)[0]}Message`]: { input: Object.values(content)[0] },
    })),
  };
});

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .png()
    .toBuffer();

const buildService = () => {
  const service = Object.create(BaileysStartupService.prototype) as any;
  service.client = { waUploadToServer: vi.fn() };
  service.instance = { wuid: '5491100000000@s.whatsapp.net' };
  service.logger = { verbose: vi.fn(), error: vi.fn() };
  return service;
};

describe('image processing on the bundled sharp', () => {
  it('converts images sent as media to jpeg', async () => {
    const source = await png(40, 20);

    const prepared = await buildService().prepareMediaMessage({
      mediatype: 'image',
      media: source.toString('base64'),
    });
    const converted = await sharp(prepared.message.imageMessage.input).metadata();

    expect(converted).toMatchObject({ format: 'jpeg', width: 40, height: 20 });
  });

  it('converts sticker images to webp', async () => {
    const webp = await buildService().convertToWebP((await png(30, 30)).toString('base64'));

    expect(await sharp(webp).metadata()).toMatchObject({ format: 'webp', width: 30, height: 30 });
  });

  it('builds the Baileys thumbnail with sharp', async () => {
    const thumb = await extractImageThumb(await png(200, 100), 32);

    expect(thumb.original).toEqual({ width: 200, height: 100 });
    expect(await sharp(thumb.buffer).metadata()).toMatchObject({ format: 'jpeg', width: 32 });
  });
});
