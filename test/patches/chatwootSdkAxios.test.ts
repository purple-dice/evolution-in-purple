import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { request as chatwootRequest } from '@figuro/chatwoot-sdk/dist/core/request';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });

describe('chatwoot sdk on the shared axios', () => {
  let server: Server;
  let base: string;
  const seen: { method?: string; url?: string; token?: string; body?: string } = {};

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      seen.method = request.method;
      seen.url = request.url;
      seen.token = request.headers.api_access_token as string;
      seen.body = await readBody(request);
      const status = request.url?.includes('missing') ? 404 : 200;
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ payload: [{ id: 7 }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const config = () => ({ basePath: base, with_credentials: true, credentials: 'include', token: 'token-1' }) as any;

  it('sends a json request and resolves the response body', async () => {
    const result = await chatwootRequest(config(), {
      method: 'POST',
      url: '/api/v1/accounts/1/contacts/filter',
      body: { payload: [{ attribute_key: 'phone_number' }] },
    });

    expect(result).toEqual({ payload: [{ id: 7 }] });
    expect(seen).toMatchObject({ method: 'POST', url: '/api/v1/accounts/1/contacts/filter', token: 'token-1' });
    expect(JSON.parse(seen.body)).toEqual({ payload: [{ attribute_key: 'phone_number' }] });
  });

  it('rejects with the http status on errors', async () => {
    await expect(chatwootRequest(config(), { method: 'GET', url: '/missing' })).rejects.toMatchObject({ status: 404 });
  });
});
