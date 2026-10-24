import { Jimp, JimpMime } from 'jimp';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .png()
    .toBuffer();

describe('jimp image processing', () => {
  it('covers an image to the Chatwoot ads thumbnail size', async () => {
    const image = await Jimp.read(await png(640, 480));

    image.cover({ w: 320, h: 180 });
    const output = await sharp(await image.getBuffer(JimpMime.png)).metadata();

    expect(output).toMatchObject({ format: 'png', width: 320, height: 180 });
  });

  it('resizes and encodes jpeg like the Baileys fallback thumbnail', async () => {
    const image = await Jimp.read(await png(200, 100));

    image.resize({ w: 32 });
    const output = await sharp(await image.getBuffer(JimpMime.jpeg, { quality: 50 })).metadata();

    expect(output).toMatchObject({ format: 'jpeg', width: 32, height: 16 });
  });

  it('rejects invalid plugin options through its schema validation', async () => {
    const image = await Jimp.read(await png(10, 10));

    expect(() => image.resize({ w: 'wide' } as any)).toThrow();
  });
});
