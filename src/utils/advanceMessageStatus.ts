import { status } from '@utils/renderStatus';

const FINAL_STATUSES = ['DELETED', 'EDITED'];
const ERROR_STATUS = status[0];
const DELIVERY_ACK_STATUS = status[3];

const statusRank = (value: string | null | undefined): number => {
  const entry = Object.entries(status).find(([, name]) => name === value);
  return entry === undefined ? -1 : Number(entry[0]);
};

export const nextMessageStatus = (current: string | null | undefined, incoming: string): string | undefined => {
  const hasCurrent = current !== null && current !== undefined;
  if (hasCurrent && (FINAL_STATUSES.includes(current) || statusRank(current) === -1)) {
    return undefined;
  }
  if (incoming === ERROR_STATUS) {
    return statusRank(current) < statusRank(DELIVERY_ACK_STATUS) ? incoming : undefined;
  }
  return statusRank(incoming) > statusRank(current) ? incoming : undefined;
};

export const statusesAdvanceableTo = (incoming: string): string[] =>
  Object.values(status).filter((current) => current !== incoming && nextMessageStatus(current, incoming) === incoming);
