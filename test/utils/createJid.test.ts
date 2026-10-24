import { createJid } from '@utils/createJid';
import { describe, expect, it } from 'vitest';

describe('createJid', () => {
  it('returns group, user, lid and broadcast jids unchanged', () => {
    expect(createJid('120363012345678901@g.us')).toBe('120363012345678901@g.us');
    expect(createJid('5511987654321@s.whatsapp.net')).toBe('5511987654321@s.whatsapp.net');
    expect(createJid('123456789@lid')).toBe('123456789@lid');
    expect(createJid('status@broadcast')).toBe('status@broadcast');
  });

  it('strips the device suffix before passing a jid through', () => {
    expect(createJid('5511987654321:12@s.whatsapp.net')).toBe('5511987654321@s.whatsapp.net');
    expect(createJid('123456789:3@lid')).toBe('123456789@lid');
    expect(createJid('status:1@broadcast')).toBe('status@broadcast');
  });

  it('drops unknown domains and builds a user jid', () => {
    expect(createJid('15551234567@x1.net')).toBe('15551234567@s.whatsapp.net');
  });

  it('treats dashed ids shorter than 24 characters as numbers', () => {
    expect(createJid('123-456')).toBe('123456@s.whatsapp.net');
  });

  it('removes plus signs, spaces and parentheses from plain numbers', () => {
    expect(createJid('+1 (555) 123 4567')).toBe('15551234567@s.whatsapp.net');
  });

  it('removes dashes from short plain numbers', () => {
    expect(createJid('+55 (11) 98765-4321')).toBe('5511987654321@s.whatsapp.net');
  });

  it('treats dashed ids with at least 24 characters as groups', () => {
    expect(createJid('5511999999999-1623281429')).toBe('5511999999999-1623281429@g.us');
  });

  it('treats numbers with at least 18 digits as groups', () => {
    expect(createJid('120363012345678901')).toBe('120363012345678901@g.us');
  });

  it('keeps 17 digit numbers as user jids', () => {
    expect(createJid('12036301234567890')).toBe('12036301234567890@s.whatsapp.net');
  });

  it('keeps the mobile 9 in 13 digit Argentine numbers', () => {
    expect(createJid('5492615550101')).toBe('5492615550101@s.whatsapp.net');
    expect(createJid('+54 9 261 555-0101')).toBe('5492615550101@s.whatsapp.net');
  });

  it.each([
    ['Buenos Aires', '5491123456789'],
    ['Cordoba', '5493511234567'],
    ['Rosario', '5493411234567'],
    ['four digit area code', '5492966123456'],
  ])('keeps the mobile 9 for %s mobiles', (_area, number) => {
    expect(createJid(number)).toBe(`${number}@s.whatsapp.net`);
  });

  it.each(['+54 9 11 2345-6789', '+54 (9) 11 2345 6789', '549-11-2345-6789', '+549 11 23456789'])(
    'normalizes the formatted Argentine mobile %s keeping the 9',
    (formatted) => {
      expect(createJid(formatted)).toBe('5491123456789@s.whatsapp.net');
    },
  );

  it('passes Argentine jids through unchanged with or without the 9', () => {
    expect(createJid('5491123456789@s.whatsapp.net')).toBe('5491123456789@s.whatsapp.net');
    expect(createJid('541123456789@s.whatsapp.net')).toBe('541123456789@s.whatsapp.net');
    expect(createJid('5491123456789:7@s.whatsapp.net')).toBe('5491123456789@s.whatsapp.net');
  });

  it('keeps Argentine numbers with fewer than 12 digits unchanged', () => {
    expect(createJid('54112345678')).toBe('54112345678@s.whatsapp.net');
  });

  it('KNOWN BUG: removes the third digit from 13 digit Mexican numbers (current behavior)', () => {
    expect(createJid('5215512345678')).toBe('525512345678@s.whatsapp.net');
  });

  it('keeps 12 digit Argentine numbers unchanged', () => {
    expect(createJid('542615550101')).toBe('542615550101@s.whatsapp.net');
  });

  it('keeps the Brazilian ninth digit when the area code is below 31', () => {
    expect(createJid('5511987654321')).toBe('5511987654321@s.whatsapp.net');
  });

  it('keeps the Brazilian ninth digit when the subscriber number starts below 7', () => {
    expect(createJid('5541961234567')).toBe('5541961234567@s.whatsapp.net');
  });

  it('drops the Brazilian ninth digit for area codes from 31 with subscriber numbers from 7', () => {
    expect(createJid('5541987654321')).toBe('554187654321@s.whatsapp.net');
  });

  it('leaves non Brazilian 13 digit numbers unchanged', () => {
    expect(createJid('4412345678901')).toBe('4412345678901@s.whatsapp.net');
  });
});
