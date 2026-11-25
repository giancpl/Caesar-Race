import { test, expect } from '@playwright/test';
import { networkInterfaces } from 'node:os';
import { banks } from '../../src/challenges/banks.js';
import { decrypt } from '../../src/core/rules.js';

async function solve(page) {
  const ciphertext = await page.locator('.ciphertext').innerText();
  const plaintext = Array.from({ length: 25 }, (_, index) => decrypt(ciphertext, index + 1)).find((candidate) => Object.values(banks).flat().some((message) => message.plaintext === candidate));
  await page.getByLabel('Your plaintext answer').fill(plaintext);
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
}
const savedSession = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('caesar-race:room:v1')));

test('Back, refresh, invitations and interrupted loading retain membership; only confirmed departure leaves', async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(120000);
  const address = Object.values(networkInterfaces()).flat().find((entry) => entry.family === 'IPv4' && !entry.internal)?.address;
  test.skip(!address, 'UNVERIFIED: no non-loopback interface for isolated LAN navigation checks');
  const url = new URL(baseURL); url.hostname = address;
  const origin = url.origin;
  const { viewport, isMobile, hasTouch } = testInfo.project.use;
  const context = await browser.newContext({ viewport, isMobile, hasTouch }); const player = await context.newPage();
  const departures = [];
  for (const target of [host, player]) target.on('request', (request) => { if (request.url().includes('action=leave')) departures.push(request.url()); });
  let releaseJoin;
  try {
    await host.goto(origin); await host.getByRole('button', { name: 'Create Room', exact: true }).click();
    await host.getByLabel('Rounds to complete').fill('2'); await host.getByRole('button', { name: 'Create room', exact: true }).click();
    const code = await host.locator('.room-code').innerText(); const hostToken = (await savedSession(host)).token;
    await host.goBack(); await expect(host.getByRole('heading', { name: 'Your room session is saved' })).toBeVisible();
    await expect(host.getByLabel('Host name')).toHaveCount(0); await host.goForward(); await expect(host.locator('.room-code')).toHaveText(code);

    let committed = false; const joinBodies = [];
    const holdJoin = new Promise((resolve) => { releaseJoin = resolve; });
    await player.route('**/api/room?action=join', async (route) => {
      joinBodies.push(route.request().postData());
      if (joinBodies.length === 1) { await route.fetch(); committed = true; await holdJoin; await route.abort(); }
      else await route.continue();
    });
    await player.goto(origin); await player.getByRole('button', { name: 'Join Room', exact: true }).click();
    await player.getByLabel('Room code').fill(code); await player.getByLabel('Player name').fill('Alice');
    await player.getByRole('button', { name: 'Join room', exact: true }).click(); await expect.poll(() => committed).toBe(true);
    const playerToken = (await savedSession(player)).token;
    await player.goBack(); await expect(player.getByRole('button', { name: 'Recover room session' })).toBeVisible();
    releaseJoin(); await expect(player.getByRole('alert')).toContainText('Connection interrupted');
    await player.reload(); await player.getByRole('button', { name: 'Recover room session' }).click();
    await expect(player.locator('.room-code')).toHaveText(code); expect(joinBodies[0]).toBe(joinBodies[1]);
    expect((await savedSession(player)).token === playerToken).toBe(true);
    await player.goto(`${origin}/?join=${code}`); await expect(player.locator('.room-code')).toHaveText(code);
    expect(new URL(player.url()).search).toBe(''); expect(joinBodies).toHaveLength(2);
    await player.goto(`${origin}/?join=AAAAAA`);
    await expect(player.getByRole('heading', { name: 'Your room session is saved' })).toBeVisible();
    expect((await savedSession(player)).token === playerToken).toBe(true);
    await player.getByRole('button', { name: 'Resume room', exact: true }).click();
    await expect(player.locator('.room-code')).toHaveText(code); expect(new URL(player.url()).search).toBe('');
    await host.bringToFront();
    await host.goto(`${origin}/?join=${code}`); await expect(host.locator('.room-code')).toHaveText(code);
    expect((await savedSession(host)).token === hostToken).toBe(true);

    await expect(host.getByRole('button', { name: 'Start race', exact: true })).toBeEnabled();
    await host.getByRole('button', { name: 'Start race', exact: true }).click();
    await host.getByRole('button', { name: 'Home', exact: true }).click(); await host.goBack();
    await expect(host.getByRole('heading', { name: 'Watch discovery happen.' })).toBeVisible();
    await player.bringToFront(); await expect(player.locator('.ciphertext')).toBeVisible();
    const ciphertext = await player.locator('.ciphertext').innerText();
    await player.getByLabel('Your plaintext answer').fill('An unfinished answer');
    await player.getByRole('button', { name: 'Increase shift', exact: true }).click();
    await player.getByRole('button', { name: 'Home', exact: true }).click(); await player.goBack();
    await expect(player.getByLabel('Your plaintext answer')).toHaveValue('An unfinished answer');
    await player.reload(); await expect(player.getByLabel('Your plaintext answer')).toHaveValue('An unfinished answer');
    await expect(player.locator('#shift-value')).toHaveText('1'); await expect(player.locator('.ciphertext')).toHaveText(ciphertext);
    await player.goto('about:blank'); await player.goBack();
    await expect(player.getByLabel('Your plaintext answer')).toHaveValue('An unfinished answer');
    await player.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    await expect(player.getByLabel('Your plaintext answer')).toHaveValue('An unfinished answer');
    await solve(player); await expect(player.getByRole('button', { name: 'Next Round', exact: true })).toBeVisible();
    await player.getByRole('button', { name: 'Home', exact: true }).click(); await player.reload();
    await player.getByRole('button', { name: 'Recover room session' }).click();
    await expect(player.getByRole('button', { name: 'Next Round', exact: true })).toBeVisible();
    await expect(player.locator('#attempts-stat')).toHaveText('1'); expect(departures).toHaveLength(0);
    expect((await savedSession(player)).token === playerToken).toBe(true); expect((await savedSession(host)).token === hostToken).toBe(true);
    await player.getByRole('button', { name: 'Next Round', exact: true }).click();
    await expect(player.getByLabel('Your plaintext answer')).toHaveValue(''); await expect(player.locator('#shift-value')).toHaveText('0');

    await player.locator('#room-session-controls summary').click(); await player.getByRole('button', { name: 'Leave room', exact: true }).click();
    await player.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click(); expect(departures).toHaveLength(0);
    await player.getByRole('button', { name: 'Leave room', exact: true }).click();
    await player.getByRole('dialog').getByRole('button', { name: 'Leave room', exact: true }).click();
    await expect(player.getByRole('heading', { name: /Caesar Race/ })).toBeVisible(); expect(await savedSession(player)).toBeNull(); expect(departures).toHaveLength(1);
    await expect(host.getByText('RACE CANCELLED', { exact: true })).toBeVisible();
    await host.locator('#room-session-controls summary').click(); await host.getByRole('button', { name: 'Close room', exact: true }).click();
    await host.keyboard.press('Escape'); expect(departures).toHaveLength(1);
    await host.getByRole('button', { name: 'Close room', exact: true }).click();
    await host.getByRole('dialog').getByRole('button', { name: 'Close room', exact: true }).click();
    await expect(host.getByRole('heading', { name: /Caesar Race/ })).toBeVisible(); expect(await savedSession(host)).toBeNull(); expect(departures).toHaveLength(2);
  } finally { releaseJoin?.(); await context.close(); }
});

test('solo Back and refresh preserve the game, draft and shift without an API', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());
  await page.goto('/'); await page.getByRole('button', { name: 'Play Solo', exact: true }).click();
  await page.getByLabel('Rounds to complete').fill('1'); await page.getByRole('button', { name: 'Start solo game' }).click();
  await expect(page.locator('.ciphertext')).toBeVisible(); const ciphertext = await page.locator('.ciphertext').innerText();
  await page.getByLabel('Your plaintext answer').fill('My solo draft'); await page.getByRole('button', { name: 'Increase shift', exact: true }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).click(); await page.goBack();
  await expect(page.getByLabel('Your plaintext answer')).toHaveValue('My solo draft');
  await page.reload(); await expect(page.getByLabel('Your plaintext answer')).toHaveValue('My solo draft');
  await expect(page.locator('#shift-value')).toHaveText('1'); await expect(page.locator('.ciphertext')).toHaveText(ciphertext);
  await solve(page); await expect(page.getByText('LOCAL RESULT — NON-AUTHORITATIVE', { exact: true })).toBeVisible();
});
