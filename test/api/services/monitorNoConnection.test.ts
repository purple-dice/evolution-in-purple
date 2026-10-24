import { BaileysStartupService } from '@api/integrations/channel/whatsapp/whatsapp.baileys.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Boom } from '@hapi/boom';
import { DisconnectReason } from 'baileys';
import EventEmitter2 from 'eventemitter2';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@api/server.module', () => ({ channelController: {} }));

const QRCODE_LIMIT = 3;

const config: Record<string, unknown> = {
  DATABASE: { SAVE_DATA: { INSTANCE: true } },
  CACHE: { REDIS: { ENABLED: false }, LOCAL: { ENABLED: false } },
  PROVIDER: { ENABLED: false },
  CHATWOOT: { ENABLED: false },
  QRCODE: { LIMIT: QRCODE_LIMIT, COLOR: '#000000' },
};

const buildMonitor = () => {
  const eventEmitter = new EventEmitter2();
  const prismaRepository = { instance: { update: vi.fn(async () => ({})) } };
  const configService = { get: vi.fn((key: string) => config[key]) };
  const monitor = new WAMonitoringService(
    eventEmitter,
    configService as any,
    prismaRepository as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { monitor, eventEmitter, prismaRepository, configService };
};

const buildService = (eventEmitter: EventEmitter2, prismaRepository: any, configService: any) => {
  const service = Object.create(BaileysStartupService.prototype) as any;
  service.client = { logout: vi.fn(async () => undefined), ws: { close: vi.fn() }, end: vi.fn() };
  service.configService = configService;
  service.prismaRepository = prismaRepository;
  service.instance = {
    id: 'instance-id',
    name: 'instance-name',
    wuid: undefined,
    qrcode: { count: QRCODE_LIMIT, code: 'stale-qr', base64: 'stale-base64' },
  };
  service.eventEmitter = eventEmitter;
  service.sendDataWebhook = vi.fn();
  service.connectToWhatsapp = vi.fn();
  service.getProfileName = vi.fn(async () => undefined);
  service.localChatwoot = { enabled: false };
  service.stateConnection = { state: 'connecting' };
  service.endSession = false;
  return service;
};

const flushHandlers = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WAMonitoringService no.connection', () => {
  let monitor: WAMonitoringService;
  let eventEmitter: EventEmitter2;
  let prismaRepository: any;
  let service: any;

  beforeEach(() => {
    const built = buildMonitor();
    monitor = built.monitor;
    eventEmitter = built.eventEmitter;
    prismaRepository = built.prismaRepository;
    service = buildService(eventEmitter, prismaRepository, built.configService);
    monitor.waInstances['instance-name'] = service;
  });

  const expectClosed = () => {
    expect(service.client.ws.close).toHaveBeenCalled();
    expect(service.client.end).toHaveBeenCalled();
    expect(service.instance.qrcode).toEqual({ count: 0 });
    expect(service.stateConnection).toEqual({ state: 'close', statusReason: DisconnectReason.connectionClosed });
    expect(prismaRepository.instance.update).toHaveBeenCalledWith({
      where: { id: 'instance-id' },
      data: { connectionStatus: 'close' },
    });
  };

  it('closes the instance when the unpaired socket rejects logout', async () => {
    service.client.logout.mockRejectedValue(new Error('Connection Closed'));

    await eventEmitter.emitAsync('no.connection', 'instance-name');

    expectClosed();
  });

  it('closes the instance when logout succeeds', async () => {
    await eventEmitter.emitAsync('no.connection', 'instance-name');

    expect(service.client.logout).toHaveBeenCalled();
    expectClosed();
  });

  it('ignores an unknown instance name', async () => {
    await expect(eventEmitter.emitAsync('no.connection', 'missing-instance')).resolves.toBeDefined();

    expect(prismaRepository.instance.update).not.toHaveBeenCalled();
  });

  it('does not reconnect after the QR limit closes the socket', async () => {
    service.client.logout.mockRejectedValue(new Error('Connection Closed'));

    await service.connectionUpdate({ qr: 'next-qr' });
    await flushHandlers();

    await service.connectionUpdate({
      connection: 'close',
      lastDisconnect: {
        error: new Boom('closed', { statusCode: DisconnectReason.connectionClosed }),
        date: new Date(),
      },
    });

    expectClosed();
    expect(service.connectToWhatsapp).not.toHaveBeenCalled();
  });
});
