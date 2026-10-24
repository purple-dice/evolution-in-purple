import { BaileysStartupService } from '@api/integrations/channel/whatsapp/whatsapp.baileys.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@api/server.module', () => ({
  chatbotController: { emit: vi.fn(async () => undefined) },
  waMonitor: {},
}));

vi.mock('@utils/onWhatsappCache', () => ({
  getOnWhatsappCache: vi.fn(async () => []),
  saveOnWhatsappCache: vi.fn(async () => undefined),
}));

vi.mock('@utils/sendTelemetry', () => ({ sendTelemetry: vi.fn() }));

vi.mock('@api/integrations/chatbot/chatwoot/utils/chatwoot-import-helper', () => ({
  chatwootImport: { getRepositoryMessagesCache: vi.fn(() => null), setRepositoryMessagesCache: vi.fn() },
}));

const LID = '123456789@lid';
const PHONE_JID = '5491123456789@s.whatsapp.net';

const buildService = (provider: string, saveData: { NEW_MESSAGE: boolean; HISTORIC: boolean }) => {
  const config: Record<string, unknown> = {
    LOG: { BAILEYS: 'error' },
    DATABASE: { PROVIDER: provider, SAVE_DATA: { ...saveData, CHATS: false, CONTACTS: false } },
    CHATWOOT: { ENABLED: false },
    OPENAI: { ENABLED: false },
    S3: { ENABLE: false },
  };
  const configService = { get: vi.fn((key: string) => config[key]) } as any;
  const service = new BaileysStartupService(
    configService,
    { emit: vi.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  ) as any;
  service.instance.id = 'instance-id';
  service.instance.name = 'instance-name';
  const schedule = vi.spyOn(service.lidRemoteJidAltBackfill, 'schedule').mockReturnValue(undefined);
  return { service, schedule };
};

const dispatch = async (service: any, events: Record<string, unknown>) => {
  let processEvents: (events: Record<string, unknown>) => Promise<void>;
  service.client = { ev: { process: vi.fn((handler) => (processEvents = handler)) } };
  service.findSettings = vi.fn(async () => ({}));
  service.eventHandler();
  await processEvents(events);
  await service.eventProcessingQueue;
};

describe('scheduleLidRemoteJidAltBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not schedule a backfill on mysql', () => {
    const { service, schedule } = buildService('mysql', { NEW_MESSAGE: true, HISTORIC: true });

    service.scheduleLidRemoteJidAltBackfill(LID, PHONE_JID);

    expect(schedule).not.toHaveBeenCalled();
  });

  it('does not schedule a backfill on postgresql when messages are not saved', () => {
    const { service, schedule } = buildService('postgresql', { NEW_MESSAGE: false, HISTORIC: false });

    service.scheduleLidRemoteJidAltBackfill(LID, PHONE_JID);

    expect(schedule).not.toHaveBeenCalled();
  });

  it.each([
    { NEW_MESSAGE: true, HISTORIC: false },
    { NEW_MESSAGE: false, HISTORIC: true },
  ])('schedules a backfill on postgresql with save flags %o', (saveData) => {
    const { service, schedule } = buildService('postgresql', saveData);

    service.scheduleLidRemoteJidAltBackfill(LID, PHONE_JID);

    expect(schedule).toHaveBeenCalledWith('instance-id', LID, PHONE_JID);
  });

  it('schedules a backfill with the lid and pn of a lid-mapping.update event', async () => {
    const { service, schedule } = buildService('postgresql', { NEW_MESSAGE: true, HISTORIC: false });

    await dispatch(service, { 'lid-mapping.update': { lid: LID, pn: PHONE_JID } });

    expect(schedule).toHaveBeenCalledWith('instance-id', LID, PHONE_JID);
  });
});
