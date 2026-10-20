import { describe, expect, it } from 'vitest';
import { decideNavigation, decideWindowOpen, isExternallyOpenable } from '../src/url-policy.js';

const origin = 'http://127.0.0.1:8088';

describe('url policy', () => {
  it('allows same-origin navigation', () => {
    expect(decideNavigation('http://127.0.0.1:8088/projects/1', origin)).toBe('allow');
  });
  it('sends other origins, ports and hosts to the system browser', () => {
    expect(decideNavigation('https://github.com/login/oauth/authorize', origin)).toBe(
      'open-external',
    );
    expect(decideNavigation('http://127.0.0.1:9999/', origin)).toBe('open-external');
    expect(decideNavigation('http://localhost:8088/', origin)).toBe('open-external');
  });
  it('blocks non-web schemes', () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'smb://host/share',
      'ms-msdt:/x',
      'not a url',
    ]) {
      expect(decideNavigation(url, origin)).toBe('block');
      expect(decideWindowOpen(url)).toBe('block');
      expect(isExternallyOpenable(url)).toBe(false);
    }
  });
  it('never opens a window in the app', () => {
    expect(decideWindowOpen('http://127.0.0.1:8088/x')).toBe('open-external');
    expect(decideWindowOpen('https://example.com')).toBe('open-external');
  });
});
