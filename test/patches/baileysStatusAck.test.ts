import makeWASocket, { initAuthCreds } from 'baileys';
import { WebSocketClient } from 'baileys/lib/Socket/Client/websocket.js';
import P from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

// WhatsApp delivers contacts' statuses as a top-level <status> stanza. Unless it
// is acked, the server ends the stream ~50 minutes later with
// <stream:error><ack class="status"/></stream:error> and redelivers it on reconnect.
const statusNode = {
  tag: 'status',
  attrs: { id: '3A2069ED', from: 'status@broadcast', participant: '5511999999999@s.whatsapp.net', type: 'media' },
};

const emitStatus = async () => {
  const creds = initAuthCreds();
  creds.me = { id: '1234567890:1@s.whatsapp.net', name: 'Test User' };
  const keys = { get: async () => ({}), set: async () => {} };
  const lines: any[] = [];
  const logger = P({ level: 'debug' }, { write: (line: string) => lines.push(JSON.parse(line)) });
  // The socket captures ws.send when it is created, so stub the client before that.
  const send = vi
    .spyOn(WebSocketClient.prototype, 'send')
    .mockImplementation(((_data: unknown, cb?: (err?: Error) => void) => cb?.()) as any);
  vi.spyOn(WebSocketClient.prototype, 'isOpen', 'get').mockReturnValue(true);
  vi.spyOn(WebSocketClient.prototype, 'connect').mockImplementation(() => {});
  const sock = makeWASocket({ auth: { creds, keys } as any, logger } as any);

  sock.ws.emit('CB:status', statusNode);
  await new Promise((resolve) => setTimeout(resolve, 50));
  sock.ws.removeAllListeners();

  return { acks: lines.filter((line) => line.msg === 'sent ack').map((line) => line.sent), send };
};

describe('<status> stanza', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is acked with class "status" and the same id, type and participant', async () => {
    const { acks, send } = await emitStatus();

    expect(acks).toEqual([
      {
        id: '3A2069ED',
        to: 'status@broadcast',
        class: 'status',
        participant: '5511999999999@s.whatsapp.net',
        type: 'media',
      },
    ]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
