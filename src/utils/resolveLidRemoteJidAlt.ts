import { type Contact, isLidUser, isPnUser, jidNormalizedUser, type LIDMapping, type WAMessage } from 'baileys';

export type LidToPnLookup = (lids: string[]) => Promise<LIDMapping[] | null>;

const toPhoneJid = (jid?: string | null): string | undefined => {
  const normalized = jid ? jidNormalizedUser(jid) : undefined;
  return normalized && isPnUser(normalized) ? normalized : undefined;
};

const contactLidToPn = (contacts: Contact[]): Map<string, string> => {
  const pairs = new Map<string, string>();
  for (const contact of contacts) {
    const lids = new Set(
      [contact.lid, contact.id].filter((jid) => jid && isLidUser(jid)).map((jid) => jidNormalizedUser(jid)),
    );
    const pn = toPhoneJid(contact.phoneNumber) ?? toPhoneJid(contact.id);
    if (lids.size === 1 && pn) {
      pairs.set([...lids][0], pn);
    }
  }
  return pairs;
};

export async function resolveLidRemoteJidAlt(
  messages: WAMessage[],
  contacts: Contact[],
  lookup?: LidToPnLookup,
  onLookupError?: (error: unknown) => void,
): Promise<void> {
  const pending = messages.filter(
    (m) => m.key?.remoteJid && isLidUser(m.key.remoteJid) && !toPhoneJid(m.key.remoteJidAlt),
  );
  if (pending.length === 0) {
    return;
  }

  const lidToPn = contactLidToPn(contacts);
  const unresolvedLids = [...new Set(pending.map((m) => jidNormalizedUser(m.key.remoteJid)))].filter(
    (lid) => !lidToPn.has(lid),
  );

  if (unresolvedLids.length > 0 && lookup) {
    try {
      const mappings = (await lookup(unresolvedLids)) ?? [];
      for (const { lid, pn } of mappings) {
        const phoneJid = toPhoneJid(pn);
        if (lid && phoneJid) {
          lidToPn.set(jidNormalizedUser(lid), phoneJid);
        }
      }
    } catch (error) {
      onLookupError?.(error);
    }
  }

  for (const m of pending) {
    const pn = lidToPn.get(jidNormalizedUser(m.key.remoteJid));
    if (pn) {
      m.key.remoteJidAlt = pn;
    }
  }
}
