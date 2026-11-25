import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { banks } from '../../src/challenges/banks.js';
import { decrypt } from '../../src/core/rules.js';

function solve(ciphertext) {
  for (let key = 1; key <= 25; key++) { const candidate = decrypt(ciphertext, key); if (Object.values(banks).flat().some((c) => c.plaintext === candidate)) return candidate; }
  throw new Error('No bank message matches ciphertext');
}
async function noOverflow(page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true); }
async function startSolo(page, difficulty = 'Easy', rounds = 2) {
  await page.goto('/'); await page.getByRole('button', { name: 'Play Solo', exact: true }).click();
  await page.getByRole('radio', { name: new RegExp(difficulty) }).check(); await page.getByLabel('Rounds to complete').fill(String(rounds));
  await page.getByRole('button', { name: 'Start solo game' }).click(); await expect(page.locator('.ciphertext')).toBeVisible();
}
async function answer(page) { const plaintext = solve(await page.locator('.ciphertext').innerText()); await page.getByLabel('Your plaintext answer').fill(plaintext); await page.getByRole('button', { name: 'Check answer', exact: true }).click(); }
test('landing and rules work by keyboard without overflow or accessibility violations', async ({ page }) => {
  await page.goto('/'); await expect(page).toHaveTitle(/Caesar Race/); await noOverflow(page);
  await page.getByRole('button', { name: 'How to play', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'How to play', exact: true })).toBeFocused();
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(report.violations).toEqual([]);
});
for (const difficulty of ['Easy', 'Hard']) test(`${difficulty} solo works through API outage, hints, feedback, refresh and results`, async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort()); await startSolo(page, difficulty);
  await noOverflow(page);
  expect(await page.getByRole('slider').count()).toBe(difficulty === 'Easy' ? 1 : 0);
  if (difficulty === 'Easy') {
    await page.getByRole('slider').focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
    await expect(page.locator('#candidate')).toHaveText(decrypt(await page.locator('.ciphertext').innerText(), 1));
    await page.getByRole('button', { name: 'Use this candidate', exact: true }).click();
    await expect(page.getByLabel('Your plaintext answer')).toHaveValue(await page.locator('#candidate').innerText());
    await expect(page.locator('#attempts-stat')).toHaveText('0');
    await page.locator('#mapping-details summary').click(); await noOverflow(page);
  }
  if (difficulty === 'Hard') await expect(page.locator('#candidate')).toHaveCount(0);
  await page.getByLabel('Your plaintext answer').fill('A wrong answer.'); await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Not quite yet' })).toBeVisible();
  await page.locator('#hints-details summary').click(); await page.getByRole('button', { name: 'Reveal hint 1' }).click();
  await expect(page.locator('.hint-card')).toHaveCount(1);
  await answer(page); await expect(page.getByRole('button', { name: 'Next Round', exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('button', { name: 'Next Round', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next Round', exact: true }).click(); await answer(page);
  await expect(page.getByText('LOCAL RESULT — NON-AUTHORITATIVE', { exact: true })).toBeVisible(); await expect(page.locator('#points-stat')).toHaveText('188');
  await noOverflow(page); await page.getByRole('button', { name: 'New game', exact: true }).click(); await expect(page.locator('.ciphertext')).toBeVisible();
});
test('answer focus survives polling, shared room lifecycle restores sessions and rematches', async ({ browser, baseURL }, testInfo) => {
  const { viewport, isMobile, hasTouch } = testInfo.project.use;
  const options = { viewport, isMobile, hasTouch };
  const hostContext = await browser.newContext(options); const playerContext = await browser.newContext(options); const otherContext = await browser.newContext(options);
  const host = await hostContext.newPage(); const player = await playerContext.newPage(); const other = await otherContext.newPage();
  for (const p of [host, player, other]) p.on('dialog', (dialog) => dialog.accept());
  try {
    await host.goto(baseURL); await host.getByRole('button', { name: 'Create Room', exact: true }).click(); await host.getByLabel('Host name').fill('Teacher');
    await host.getByLabel('Rounds to complete').fill('2'); await host.getByRole('button', { name: 'Create room', exact: true }).click();
    const code = await host.locator('.room-code').innerText(); await expect(host.getByRole('button', { name: 'Start race', exact: true })).toBeDisabled();
    await noOverflow(host);
    for (const [p, name] of [[player, 'Alice'], [other, 'Bob']]) {
      await p.goto(`${baseURL}/?join=${code}`); await p.getByLabel('Player name').fill(name); await p.getByRole('button', { name: 'Join room', exact: true }).click();
      await expect(p.getByRole('heading', { name: 'A little anticipation.' })).toBeVisible();
    }
    await expect(host.getByRole('button', { name: 'Start race', exact: true })).toBeEnabled();
    await expect(host.locator('[data-occupancy]').first()).toHaveText('2/30 players');
    await host.getByRole('button', { name: 'Start race', exact: true }).click();
    await expect(player.locator('.ciphertext')).toBeVisible(); await expect(other.locator('.ciphertext')).toBeVisible();
    await noOverflow(player);
    expect(await player.locator('.ciphertext').innerText()).toBe(await other.locator('.ciphertext').innerText());
    await player.getByLabel('Your plaintext answer').fill('Draft survives polling'); await player.getByLabel('Your plaintext answer').focus();
    await expect.poll(async () => { await player.waitForResponse((r) => r.url().includes('action=status')); return player.getByLabel('Your plaintext answer').inputValue(); }).toBe('Draft survives polling');
    await expect(player.getByLabel('Your plaintext answer')).toBeFocused();
    await player.reload(); await expect(player.locator('.ciphertext')).toBeVisible();
    await answer(player); await expect(player.getByRole('button', { name: 'Next Round', exact: true })).toBeVisible();
    await expect(other.locator('.badge').filter({ hasText: 'MESSAGE 1 OF 2' })).toBeVisible();
    await player.getByRole('button', { name: 'Next Round', exact: true }).click(); await answer(player);
    await expect(host.getByRole('heading', { name: 'Alice wins the race!' })).toBeVisible(); await expect(other.getByRole('heading', { name: 'Alice wins the race!' })).toBeVisible();
    await noOverflow(host); await noOverflow(player);
    const before = await host.evaluate(() => JSON.parse(sessionStorage.getItem('caesar-race:room:v1')).token);
    await host.getByRole('button', { name: 'Prepare rematch', exact: true }).click(); await expect(player.locator('.room-code')).toHaveText(code);
    expect(await host.evaluate(() => JSON.parse(sessionStorage.getItem('caesar-race:room:v1')).token)).toBe(before);
    await host.getByRole('button', { name: 'Cancel race', exact: true }).click(); await host.getByRole('dialog').getByRole('button', { name: 'Cancel race', exact: true }).click();
    await expect(player.getByText('RACE CANCELLED', { exact: true })).toBeVisible();
  } finally { await Promise.all([hostContext.close(), playerContext.close(), otherContext.close()]); }
});
test('uncertain committed answer recovers once, then network drafts remain editable', async ({ page }) => {
  await page.goto('/#create'); await page.getByLabel('Host name').fill('Playing host'); await page.getByLabel('Rounds to complete').fill('2'); await page.getByLabel('Participate as a player').check(); await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await page.getByRole('button', { name: 'Start race', exact: true }).click(); await expect(page.locator('.ciphertext')).toBeVisible();
  let dropped = false;
  await page.route('**/api/room?action=answer', async (route) => { if (!dropped) { dropped = true; await route.fetch(); await route.abort(); } else await route.continue(); });
  await answer(page); await expect(page.getByRole('button', { name: 'Next Round', exact: true })).toBeVisible({ timeout: 15000 }); await expect(page.locator('#attempts-stat')).toHaveText('1');
  await page.getByRole('button', { name: 'Next Round', exact: true }).click(); await page.getByLabel('Your plaintext answer').fill('Keep this answer');
  await page.context().setOffline(true); await expect(page.getByRole('alert')).toContainText(/Connection|Reconnecting/); await expect(page.getByLabel('Your plaintext answer')).toHaveValue('Keep this answer');
  await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
  await page.context().setOffline(false); await expect(page.getByRole('alert')).not.toBeVisible(); await expect(page.getByLabel('Your plaintext answer')).toHaveValue('Keep this answer');
});
test('reduced motion and gameplay accessibility', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await startSolo(page, 'Easy', 1); await noOverflow(page);
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(report.violations).toEqual([]);
  await page.getByLabel('Your plaintext answer').focus(); await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Check answer', exact: true })).toBeFocused();
});
test('setup retains selected settings after a validation error', async ({ page }) => {
  await page.goto('/#create');
  await page.getByLabel('Host name').fill('W'.repeat(25));
  await page.getByRole('radio', { name: /Hard/ }).check();
  await page.getByLabel('Rounds to complete').fill('5');
  await page.getByLabel('Participate as a player').check();
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Choose a name');
  await expect(page.getByRole('radio', { name: /Hard/ })).toBeChecked();
  await expect(page.getByLabel('Participate as a player')).toBeChecked();
  await expect(page.getByLabel('Rounds to complete')).toHaveValue('5');
});
test('production headers and local QR invitations work without external requests', async ({ page }) => {
  const violations = [];
  let dropped = false;
  let committedCode;
  await page.route('**/api/room?action=create', async (route) => {
    if (dropped) { await route.continue(); return; }
    dropped = true;
    const response = await route.fetch(); committedCode = (await response.json()).room.code;
    await route.abort();
  });
  await page.addInitScript(() => { window.securityViolations = []; document.addEventListener('securitypolicyviolation', (event) => window.securityViolations.push(event.violatedDirective)); });
  page.on('pageerror', (error) => violations.push(error.message));
  const response = await page.goto('/#create');
  expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
  await page.getByLabel('Host name').fill('<img src=x>');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Connection interrupted');
  await page.reload();
  await expect(page.locator('.room-code')).toHaveText(committedCode);
  await expect(page.getByText('Host: <img src=x>', { exact: true })).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Enlarge invitation QR code' }).click();
  await expect(page.getByRole('dialog').getByRole('img')).toHaveAttribute('src', /^data:image\/png/);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.securityViolations)).toEqual([]);
  expect(violations).toEqual([]);
});
test('expired session recovery shows an actionable terminal screen', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('caesar-race:room:v1', JSON.stringify({ token: 'a'.repeat(43), code: 'ABC234', expiresAt: Date.now() - 10000 })));
  await page.route('**/api/room?action=status*', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'ROOM_UNAVAILABLE' }) }));
  await page.goto('/#room'); await page.reload(); await expect(page.getByText('ROOM EXPIRED', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Return home', exact: true }).click(); await expect(page.getByRole('button', { name: 'Play Solo', exact: true })).toBeVisible();
});
