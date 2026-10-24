import { PrismaRepository } from '@api/repository/repository.service';
import { Logger } from '@config/logger.config';
import { jidNormalizedUser } from 'baileys';

const MAX_TRACKED_LIDS = 10_000;
const LID_SUFFIX = '@lid';
const PHONE_SUFFIX = '@s.whatsapp.net';

export class LidRemoteJidAltBackfill {
  private readonly backfilledLids = new Set<string>();

  constructor(
    private readonly prismaRepository: PrismaRepository,
    private readonly logger: Logger,
  ) {}

  public schedule(instanceId: string, lid?: string, phoneJid?: string): Promise<void> | undefined {
    if (!instanceId || !lid || !phoneJid) return undefined;

    const normalizedLid = jidNormalizedUser(lid);
    const normalizedPhoneJid = jidNormalizedUser(phoneJid);
    if (!normalizedLid.endsWith(LID_SUFFIX) || !normalizedPhoneJid.endsWith(PHONE_SUFFIX)) return undefined;

    const trackingKey = `${instanceId}:${normalizedLid}`;
    if (this.backfilledLids.has(trackingKey)) return undefined;
    if (this.backfilledLids.size >= MAX_TRACKED_LIDS) this.backfilledLids.clear();
    this.backfilledLids.add(trackingKey);

    return this.backfill(instanceId, normalizedLid, normalizedPhoneJid);
  }

  private async backfill(instanceId: string, lid: string, phoneJid: string): Promise<void> {
    try {
      const updatedRows = await this.prismaRepository.$executeRaw`
        UPDATE "Message"
        SET "key" = jsonb_set("key"::jsonb, '{remoteJidAlt}', to_jsonb(${phoneJid}::text), true)
        WHERE "instanceId" = ${instanceId}
        AND "key"->>'remoteJid' = ${lid}
        AND COALESCE("key"->>'remoteJidAlt', '') NOT LIKE ${`%${PHONE_SUFFIX}`}
      `;
      if (updatedRows > 0) this.logger.verbose(`Backfilled remoteJidAlt on ${updatedRows} messages for ${lid}`);
    } catch (error) {
      this.logger.warn(`Failed to backfill remoteJidAlt for ${lid}: ${error?.message ?? error}`);
    }
  }
}
