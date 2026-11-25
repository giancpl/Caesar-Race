import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { banks } from '../src/challenges/banks.js';
import { decrypt } from '../src/core/rules.js';

const label = process.argv[2] || 'current';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use a simple capture label');
const origin = process.env.CAESAR_CAPTURE_URL || 'http://127.0.0.1:5173';
const directory = `design-artifacts/${label}`;
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
async function capture(page, viewport, name) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: `${directory}/${viewport}-${name}.png`, fullPage: true, animations: 'disabled' });
}
async function answer(page) {
  const ciphertext = await page.locator('.ciphertext').innerText();
  const plaintext = Array.from({ length: 25 }, (_, i) => decrypt(ciphertext, i + 1)).find((text) => Object.values(banks).flat().some((message) => message.plaintext === text));
  await page.getByLabel('Your plaintext answer').fill(plaintext);
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
}
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(origin); await capture(page, name, 'landing');
    await page.getByRole('button', { name: 'Play Solo', exact: true }).click(); await capture(page, name, 'setup');
    await page.getByLabel('Rounds to complete').fill('2');
    await page.getByRole('button', { name: 'Start solo game' }).click();
    await page.locator('.countdown').waitFor(); await capture(page, name, 'countdown');
    await page.locator('.ciphertext').waitFor(); await capture(page, name, 'playing');
    await answer(page); await page.getByRole('button', { name: 'Next Round', exact: true }).waitFor(); await capture(page, name, 'feedback');
    await page.getByRole('button', { name: 'Next Round', exact: true }).click(); await answer(page);
    await page.getByText('LOCAL RESULT — NON-AUTHORITATIVE', { exact: true }).waitFor(); await capture(page, name, 'results');
    await page.goto(`${origin}/#create`); await page.getByLabel('Host name').fill('Workshop host');
    await page.getByRole('button', { name: 'Create room', exact: true }).click();
    const code = await page.locator('.room-code').innerText();
    await page.locator('.qr-button img').waitFor(); await capture(page, name, 'lobby');
    const playerContext = await browser.newContext({ viewport, reducedMotion: 'reduce' }); const player = await playerContext.newPage();
    await player.goto(`${origin}/?join=${code}`); await player.getByLabel('Player name').fill('Alice');
    await player.getByRole('button', { name: 'Join room', exact: true }).click();
    await page.getByRole('button', { name: 'Start race', exact: true }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find((button) => button.textContent === 'Start race')?.disabled);
    await page.getByRole('button', { name: 'Start race', exact: true }).click();
    await player.locator('.ciphertext').waitFor(); await page.getByRole('heading', { name: 'Watch discovery happen.' }).waitFor();
    await capture(page, name, 'dashboard');
    await page.getByRole('button', { name: 'Cancel race', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel race', exact: true }).click();
    await page.getByText('RACE CANCELLED', { exact: true }).waitFor(); await capture(page, name, 'terminal');
    await playerContext.close(); await context.close();
  }
} finally { await browser.close(); }
console.log(`Captured representative desktop/mobile screens in ${directory}`);
