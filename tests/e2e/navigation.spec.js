import { test, expect } from '@playwright/test';

test('browser can navigate after reloading a pushState history entry', async ({ page }) => {
  // Playwright 1.56.1's WebKit crashes here even without application code.
  await page.route('http://navigation.test/**', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Navigation fixture</title><p>History is available.</p>'
  }));
  await page.goto('http://navigation.test/a');
  await page.evaluate(() => history.pushState({}, '', '/a?restored=1'));
  await page.reload();
  await page.goto('http://navigation.test/b');
  await expect(page).toHaveURL('http://navigation.test/b');
  await expect(page.getByText('History is available.', { exact: true })).toBeVisible();
});
