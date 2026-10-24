import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname } from 'node:path';
import { Readable } from 'node:stream';

import * as Minio from 'minio';
import { describe, expect, it, vi } from 'vitest';

const requireFromMinio = createRequire(createRequire(__filename).resolve('minio'));
const { NotificationPoller } = requireFromMinio('./notification.js');

describe('minio on its patched dependencies', () => {
  it('requires the stream-json parser with the exact file name case', () => {
    const source = readFileSync(requireFromMinio.resolve('./notification.js'), 'utf8');
    const [, specifier] = source.match(/require\("(stream-json[^"]*)"\)/);
    const resolved = requireFromMinio.resolve(specifier);

    expect(readdirSync(dirname(resolved))).toContain(basename(resolved));
  });

  it.each([
    ['commonjs', () => requireFromMinio('./minio.js').Client],
    ['esm', () => Minio.Client],
  ])('signs presigned urls with response header parameters (%s build)', async (_build, loadClient) => {
    const Client = loadClient();
    const client = new Client({
      endPoint: 's3.example.com',
      accessKey: 'access',
      secretKey: 'secret',
      region: 'us-east-1',
    });

    const url = new URL(
      await client.presignedGetObject('media', 'photo.png', 60, { 'response-content-type': 'image/png' }, new Date(0)),
    );

    expect(url.searchParams.get('response-content-type')).toBe('image/png');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('X-Amz-Credential')).toBe('access/19700101/us-east-1/s3/aws4_request');
  });

  it('emits bucket notifications parsed from the json lines stream', async () => {
    const records = [{ s3: { object: { key: 'a.png' } } }, { s3: { object: { key: 'b.png' } } }];
    const body = `${JSON.stringify({ Records: [records[0]] })}\n${JSON.stringify({ Records: [records[1]] })}\n`;
    const client = { region: 'us-east-1', makeRequestAsync: vi.fn(async () => Readable.from([body])) };
    const poller = new NotificationPoller(client, 'media', '', '', ['s3:ObjectCreated:*']);
    const received: unknown[] = [];

    await new Promise<void>((resolve) => {
      poller.on('notification', (record) => {
        received.push(record);
        if (received.length === records.length) {
          poller.stop();
          resolve();
        }
      });
      poller.start();
    });

    expect(received).toEqual(records);
  });
});
