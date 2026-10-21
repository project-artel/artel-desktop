import { _electron as electron } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const executablePath = path.resolve(process.argv[2]);
const dataDir = path.resolve(process.argv[3]);
await mkdir(dataDir, { recursive: true });
const app = await electron.launch({
  executablePath,
  env: { ...process.env, ARTEL_DATA_DIR: dataDir, ARTEL_DISABLE_UPDATES: '1' },
  timeout: 60000,
});
try {
  const deadline = Date.now() + 300000;
  let consolePage;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      if (page.url().startsWith('http://127.0.0.1:')) consolePage = page;
      if (page.url().includes('startup.html')) {
        const state = await page.evaluate(() => window.artelStartup?.getState());
        if (state?.phase === 'failed') throw new Error(state.error);
      }
    }
    if (consolePage) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(consolePage, 'The installed app did not open the console');
  await consolePage.waitForLoadState('domcontentloaded');
  await consolePage.locator('input').first().waitFor({ timeout: 30000 });
  await consolePage.screenshot({ path: path.join(dataDir, 'installed-console.png') });
  const state = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8'));
  console.log(`Installed ARTEL opened ${consolePage.url()}`);
  console.log(`Services: ${JSON.stringify(state.services)}`);
  const response = await fetch(new URL('/api/auth/me', consolePage.url()));
  assert.equal(response.status, 401);
  console.log('Installed console and orchestration verified');
  if (process.argv.includes('--signup')) {
    await consolePage.getByRole('button', { name: 'Create account', exact: true }).click();
    await consolePage.locator('input[autocomplete="name"]').fill('Installer smoke test');
    await consolePage.locator('input[type="email"]').fill('installer-smoke@example.test');
    await consolePage
      .locator('input[type="password"]')
      .fill(`Artel-${randomBytes(16).toString('hex')}!`);
    const signup = consolePage.waitForResponse((result) =>
      result.url().endsWith('/api/auth/signup'),
    );
    await consolePage.locator('button[type="submit"]').click();
    assert.ok((await signup).ok(), 'First account signup failed');
    await consolePage.waitForFunction(async () => (await fetch('/api/auth/me')).status === 200);
    await consolePage.screenshot({ path: path.join(dataDir, 'first-account.png') });
    console.log('First account signup and authenticated session verified');
  }
} finally {
  await app.close();
}
