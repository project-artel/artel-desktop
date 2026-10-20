/** True when `target` is on the same origin as `appOrigin`. */
export function isSameOrigin(target: string, appOrigin: string): boolean {
  try {
    return new URL(target).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

/** Only http and https may be handed to the system browser. */
export function isExternallyOpenable(target: string): boolean {
  try {
    const { protocol } = new URL(target);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export type NavigationDecision = 'allow' | 'open-external' | 'block';

/** Decision for in-window navigation: stay on the app origin, send web links out, drop the rest. */
export function decideNavigation(target: string, appOrigin: string): NavigationDecision {
  if (isSameOrigin(target, appOrigin)) return 'allow';
  return isExternallyOpenable(target) ? 'open-external' : 'block';
}

/** `window.open` and `target=_blank` never create a window in the app. */
export function decideWindowOpen(target: string): 'open-external' | 'block' {
  return isExternallyOpenable(target) ? 'open-external' : 'block';
}
