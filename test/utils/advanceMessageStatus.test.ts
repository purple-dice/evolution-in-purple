import { nextMessageStatus, statusesAdvanceableTo } from '@utils/advanceMessageStatus';
import { describe, expect, it } from 'vitest';

describe('nextMessageStatus', () => {
  it('writes the first ack when there is no current status', () => {
    expect(nextMessageStatus(undefined, 'SERVER_ACK')).toBe('SERVER_ACK');
    expect(nextMessageStatus(null, 'DELIVERY_ACK')).toBe('DELIVERY_ACK');
  });

  it('treats an unknown current status as the lowest rank', () => {
    expect(nextMessageStatus('UNKNOWN', 'PENDING')).toBe('PENDING');
  });

  it('advances to a higher status', () => {
    expect(nextMessageStatus('PENDING', 'SERVER_ACK')).toBe('SERVER_ACK');
    expect(nextMessageStatus('READ', 'PLAYED')).toBe('PLAYED');
  });

  it('skips a backward ack', () => {
    expect(nextMessageStatus('READ', 'DELIVERY_ACK')).toBeUndefined();
  });

  it('skips an equal status', () => {
    expect(nextMessageStatus('DELIVERY_ACK', 'DELIVERY_ACK')).toBeUndefined();
  });

  it('writes ERROR over non-final statuses', () => {
    expect(nextMessageStatus('PENDING', 'ERROR')).toBe('ERROR');
    expect(nextMessageStatus('SERVER_ACK', 'ERROR')).toBe('ERROR');
  });

  it('does not write ERROR after the message was delivered', () => {
    for (const current of ['DELIVERY_ACK', 'READ', 'PLAYED']) {
      expect(nextMessageStatus(current, 'ERROR')).toBeUndefined();
    }
  });

  it('never overwrites DELETED or EDITED', () => {
    for (const current of ['DELETED', 'EDITED']) {
      for (const incoming of ['ERROR', 'PENDING', 'SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED']) {
        expect(nextMessageStatus(current, incoming)).toBeUndefined();
      }
    }
  });

  it('lists the stored statuses an incoming status may replace', () => {
    expect(statusesAdvanceableTo('DELIVERY_ACK')).toEqual(['ERROR', 'PENDING', 'SERVER_ACK']);
    expect(statusesAdvanceableTo('ERROR')).toEqual(['PENDING', 'SERVER_ACK']);
    expect(statusesAdvanceableTo('PENDING')).toEqual(['ERROR']);
  });
});
