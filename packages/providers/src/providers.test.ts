import { afterEach, describe, expect, it } from 'vitest';
import { resetConfig } from '@cep/core';
import { buildEzagelRequest, isOptOutKeyword, mapEzagelDlrStatus, normalizeEgyptMobile, parseEzagelResponse, smsParts } from './ezagel';
import { buildFcmMessage } from './fcm';
import { buildSendGridMail } from './sendgrid';
import type { OutboundMessage } from './types';

afterEach(() => {
  delete process.env.EZAGEL_REQUEST_FORMAT;
  delete process.env.EZAGEL_PARAM_MAP;
  resetConfig();
});

describe('eZagel', () => {
  it('normalises Egyptian mobiles', () => {
    expect(normalizeEgyptMobile('01012345678')).toBe('201012345678');
    expect(normalizeEgyptMobile('+20 101 234 5678')).toBe('201012345678');
    expect(normalizeEgyptMobile('00201512345678')).toBe('201512345678');
    expect(normalizeEgyptMobile('201112345678', 'local')).toBe('01112345678');
    expect(normalizeEgyptMobile('0223456789')).toBeNull(); // landline
  });

  it('counts SMS parts for Arabic (UCS-2) vs English (GSM-7)', () => {
    expect(smsParts('a'.repeat(160))).toBe(1);
    expect(smsParts('a'.repeat(161))).toBe(2);
    expect(smsParts('ذ'.repeat(70))).toBe(1);
    expect(smsParts('ذ'.repeat(71))).toBe(2);
  });

  it('builds a form request with configurable parameter names', () => {
    resetConfig({ EZAGEL_BASE_URL: 'https://sms.example/send', EZAGEL_USERNAME: 'u', EZAGEL_PASSWORD: 'p', EZAGEL_SENDER_ID: 'mngm' });
    process.env.EZAGEL_PARAM_MAP = JSON.stringify({ mobile: 'Mobile_NO', message: 'Msg' });
    const req = buildEzagelRequest('201012345678', 'مرحبا', 'm1');
    expect(req.method).toBe('POST');
    const body = new URLSearchParams(req.body);
    expect(body.get('Mobile_NO')).toBe('201012345678');
    expect(body.get('Msg')).toBe('مرحبا');
    expect(body.get('language')).toBe('2');
    expect(body.get('sender')).toBe('mngm');
  });

  it('supports query and JSON formats', () => {
    resetConfig({ EZAGEL_BASE_URL: 'https://sms.example/send', EZAGEL_USERNAME: 'u', EZAGEL_PASSWORD: 'p' });
    process.env.EZAGEL_REQUEST_FORMAT = 'query';
    expect(buildEzagelRequest('2010', 'hi', 'm1').url).toContain('mobile=2010');
    process.env.EZAGEL_REQUEST_FORMAT = 'json';
    expect(JSON.parse(buildEzagelRequest('2010', 'hi', 'm1').body!)).toMatchObject({ mobile: '2010', message: 'hi' });
  });

  it('parses responses', () => {
    expect(parseEzagelResponse(200, '{"id": 12345678}', 'm1')).toMatchObject({ accepted: true, providerMessageId: '12345678' });
    expect(parseEzagelResponse(200, 'Error: invalid sender', 'm1').accepted).toBe(false);
    expect(parseEzagelResponse(401, 'unauthorized', 'm1')).toMatchObject({ accepted: false, permanent: true });
    expect(parseEzagelResponse(503, 'busy', 'm1')).toMatchObject({ accepted: false, permanent: false });
  });

  it('maps DLR statuses and opt-out keywords', () => {
    expect(mapEzagelDlrStatus('DELIVRD')).toBe('delivered');
    expect(mapEzagelDlrStatus('UNDELIV')).toBe('failed');
    expect(isOptOutKeyword('stop')).toBe(true);
    expect(isOptOutKeyword(' إلغاء ')).toBe(true);
    expect(isOptOutKeyword('stopwatch')).toBe(false);
  });
});

const msg = (over: Partial<OutboundMessage> = {}): OutboundMessage => ({
  id: 'msg-1',
  channel: 'email',
  language: 'en',
  to: 'a@b.com',
  subject: 'Hi',
  body: 'Body',
  html: '<p>Body</p>',
  category: 'D',
  topic: 'promotions',
  marketing: true,
  unsubscribeUrl: 'https://cep.example/u/tok',
  ...over,
});

describe('SendGrid payload', () => {
  it('uses the marketing subdomain, unsubscribe group and one-click header for marketing', () => {
    resetConfig({ SENDGRID_UNSUB_GROUP_ID: '42', SENDGRID_FROM_MARKETING: 'mngm <news@mail.mngm.com>' });
    const m = buildSendGridMail(msg());
    expect(m.from).toEqual({ name: 'mngm', email: 'news@mail.mngm.com' });
    expect(m.asm).toEqual({ groupId: 42 });
    expect(m.headers).toMatchObject({ 'List-Unsubscribe': '<https://cep.example/u/tok>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    expect(m.customArgs.messageId).toBe('msg-1');
  });
  it('uses the transactional subdomain without unsubscribe for Category A', () => {
    resetConfig({ SENDGRID_FROM_TRANSACTIONAL: 'mngm <no-reply@tx.mngm.com>' });
    const m = buildSendGridMail(msg({ marketing: false, category: 'A', topic: 'transactional' }));
    expect(m.from.email).toBe('no-reply@tx.mngm.com');
    expect(m.asm).toBeUndefined();
    expect(m.headers).toBeUndefined();
  });
});

describe('FCM payload', () => {
  it('carries the deep link and a per-category Android channel', () => {
    const m = buildFcmMessage(msg({ channel: 'push', title: 'Done', deepLink: 'mngm://app/orders/1', category: 'A', topic: 'transactional' }), ['t1', 't2']);
    expect(m.tokens).toEqual(['t1', 't2']);
    expect(m.data).toMatchObject({ deepLink: 'mngm://app/orders/1', messageId: 'msg-1' });
    expect(m.android?.notification?.channelId).toBe('transactional');
    expect(m.android?.priority).toBe('high');
  });
});
