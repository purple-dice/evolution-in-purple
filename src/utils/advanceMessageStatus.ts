import { status } from '@utils/renderStatus';

const FINAL_STATUSES = ['DELETED', 'EDITED'];
const ERROR_STATUS = status[0];
const DELIVERY_ACK_STATUS = status[3];

const statusRank = (value: string | null | undefined): number => {
  const entry = Object.entries(status).find(([, name]) => name === value);
  return entry === undefined ? -1 : Number(entry[0]);
};

export const nextMessageStatus = (current: string | null | undefined, incoming: string): string | undefined => {
  if (current !== null && current !== undefined && FINAL_STATUSES.includes(current)) {
    return undefined;
  }
  if (incoming === ERROR_STATUS) {
    return statusRank(current) < statusRank(DELIVERY_ACK_STATUS) ? incoming : undefined;
  }
  return statusRank(incoming) > statusRank(current) ? incoming : undefined;
};
