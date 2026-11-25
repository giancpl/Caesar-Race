import { test, expect } from '@playwright/test';
import { networkInterfaces } from 'node:os';
import { banks } from '../../src/challenges/banks.js';
import { decrypt } from '../../src/core/rules.js';

test('HTTP LAN origin supports solo, room creation, joining and a complete race', async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(90000);
  const address = Object.values(networkInterfaces()).flat().find((entry) => entry.family === 'IPv4' && !entry.internal)?.address;
  test.skip(!address, 'UNVERIFIED: no non-loopback IPv4 interface is available');
  const url = new URL(baseURL); url.hostname = address;
  const origin = url.origin;
  const { viewport, isMobile, hasTouch } = testInfo.project.use;
  const context = await browser.newContext({ viewport, isMobile, hasTouch }); const player = await context.newPage();
  async function solve(target) {
    const ciphertext = await target.locator('.ciphertext').innerText();
    const plaintext = Array.from({ length: 25 }, (_, index) => decrypt(ciphertext, index + 1)).find((candidate) => Object.values(banks).flat().some((message) => message.plaintext === candidate));
    await target.getByLabel('Your plaintext answer').fill(plaintext);
    await target.getByRole('button', { name: 'Check answer', exact: true }).click();
  }
  try {
    await page.goto(origin);
    expect(await page.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID, random: typeof crypto.getRandomValues }))).toEqual({ secure: false, uuid: 'undefined', random: 'function' });
    await page.route('**/api/**', (route) => route.abort());
    await page.getByRole('button', { name: 'Play Solo', exact: true }).click();
    await page.getByLabel('Rounds to complete').fill('1'); await page.getByRole('button', { name: 'Start solo game' }).click();
    await expect(page.locator('.ciphertext')).toBeVisible(); await solve(page);
    await expect(page.getByText('LOCAL RESULT — NON-AUTHORITATIVE', { exact: true })).toBeVisible();
    await page.unroute('**/api/**'); await page.goto(`${origin}/#create`);
    await page.getByLabel('Rounds to complete').fill('1'); await page.getByRole('button', { name: 'Create room', exact: true }).click();
    const code = await page.locator('.room-code').innerText();
    await page.getByRole('button', { name: 'Copy link', exact: true }).click();
    await expect(page.getByLabel('Select and copy')).toHaveValue(`${origin}/?join=${code}`);
    await expect(page.locator('.qr-button img')).toHaveAttribute('src', /^data:image\/png/);
    await player.goto(`${origin}/?join=${code}`); await player.getByLabel('Player name').fill('LAN player'); await player.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start race', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Start race', exact: true }).click();
    await expect(player.locator('.ciphertext')).toBeVisible(); await solve(player);
    await expect(page.getByRole('heading', { name: 'LAN player wins the race!' })).toBeVisible();
    await player.reload(); await expect(player.getByRole('heading', { name: 'You found the finish.' })).toBeVisible();
  } finally { await context.close(); }
});
