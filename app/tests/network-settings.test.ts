import { describe, expect, it } from 'vitest';
import {
  defaultPublicUrl,
  parseNetworkDraft,
  plainTextWarning,
  toSettingsChanges,
  type NetworkDraft,
} from '../src/network-settings.js';

const base: NetworkDraft = {
  shared: true,
  port: 8088,
  publicUrl: '',
  useTls: false,
  certFile: null,
  keyFile: null,
};

describe('plainTextWarning', () => {
  it('warns when sharing with an http public URL', () => {
    expect(plainTextWarning({ shared: true, publicUrl: 'http://192.168.0.5:8088' }, '')).toBe(
      'plain-text',
    );
  });

  it('falls back to the derived URL when the field is blank', () => {
    expect(plainTextWarning({ shared: true, publicUrl: ' ' }, 'http://host:8088')).toBe(
      'plain-text',
    );
    expect(plainTextWarning({ shared: true, publicUrl: '' }, 'https://host:8088')).toBeNull();
  });

  it('stays quiet for https or when not sharing', () => {
    expect(
      plainTextWarning({ shared: true, publicUrl: 'https://artel.example.com' }, ''),
    ).toBeNull();
    expect(plainTextWarning({ shared: false, publicUrl: 'http://127.0.0.1:8088' }, '')).toBeNull();
  });

  it('ignores an unparsable URL', () => {
    expect(plainTextWarning({ shared: true, publicUrl: 'not a url' }, '')).toBeNull();
  });
});

describe('defaultPublicUrl', () => {
  it('uses loopback when not shared and the machine name when shared', () => {
    expect(defaultPublicUrl({ shared: false, port: 9000, useTls: false }, 'box')).toBe(
      'http://127.0.0.1:9000',
    );
    expect(defaultPublicUrl({ shared: true, port: 9000, useTls: true }, 'box')).toBe(
      'https://box:9000',
    );
  });
});

describe('toSettingsChanges', () => {
  it('maps the toggle to the host and drops tls files when HTTPS is off', () => {
    const settings = toSettingsChanges({ ...base, certFile: '/c', keyFile: '/k' }, 'box');
    expect(settings).toEqual({
      host: '0.0.0.0',
      port: 8088,
      publicUrl: 'http://box:8088',
      tls: null,
    });
  });

  it('keeps tls files when HTTPS is on', () => {
    const settings = toSettingsChanges(
      {
        ...base,
        shared: false,
        useTls: true,
        certFile: '/c',
        keyFile: '/k',
        publicUrl: 'https://x.io',
      },
      'box',
    );
    expect(settings.host).toBe('127.0.0.1');
    expect(settings.tls).toEqual({ certFile: '/c', keyFile: '/k' });
    expect(settings.publicUrl).toBe('https://x.io');
  });
});

describe('parseNetworkDraft', () => {
  const allowed = new Set(['/c.pem', '/k.pem']);
  const good = { ...base, useTls: true, certFile: '/c.pem', keyFile: '/k.pem' };

  it('accepts a well-formed payload', () => {
    expect(parseNetworkDraft(good, allowed)).toEqual({ ok: true, draft: good });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a missing field', { ...base, port: undefined }],
    ['an extra field', { ...good, extra: 1 }],
    ['a string port', { ...good, port: '80' }],
    ['a fractional port', { ...good, port: 80.5 }],
    ['a non-boolean toggle', { ...good, shared: 'yes' }],
    ['an oversized URL', { ...good, publicUrl: 'h'.repeat(3000) }],
    ['a path never picked', { ...good, certFile: '/etc/shadow' }],
    ['an empty path', { ...good, keyFile: '' }],
    ['a NUL in a path', { ...good, keyFile: '/k.pem\0' }],
  ])('rejects %s', (_label, payload) => {
    expect(parseNetworkDraft(payload, allowed).ok).toBe(false);
  });
});
