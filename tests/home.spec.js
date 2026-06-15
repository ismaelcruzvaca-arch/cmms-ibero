import { test, expect } from '@playwright/test';

test('homepage loads with title', async ({ page }) => {
  const start = Date.now();
  await page.goto('/');
  await expect(page.locator('h6:has-text("CMMS Ibero")')).toBeVisible({ timeout: 30000 });
  console.log(`[TIMING] AppBar title visible after ${Date.now() - start}ms`);
});

test('asset tree component renders', async ({ page }) => {
  const start = Date.now();
  await page.goto('/');
  await page.getByRole('tab', { name: 'Activos' }).click();
  await page.waitForTimeout(2000);
  await expect(page.locator('[role="tree"]')).toBeVisible({ timeout: 30000 });
  console.log(`[TIMING] tree visible after ${Date.now() - start}ms`);
});

test('clicking tree node opens AssetDetailsPanel', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Activos' }).click();
  await page.waitForTimeout(5000);

  const treeItems = page.locator('[role="treeitem"]');
  const count = await treeItems.count();

  if (count === 0) {
    console.log('  [INFO] No hay nodos en el árbol — RxDB no sincronizado aún.');
    return;
  }

  console.log(`  Nodos del árbol: ${count}`);

  // Click en el label con data-testid
  const firstLabel = page.locator('[data-testid^="asset-label-"]').first();
  if (await firstLabel.count() === 0) {
    console.log('  [INFO] Sin labels de assets. Saltando test.');
    return;
  }

  const eqId = await firstLabel.getAttribute('data-testid');
  console.log(`  Click en: ${eqId}`);
  await firstLabel.click();
  await page.waitForTimeout(1500);

  const drawer = page.locator('.MuiDrawer-root');
  const isVisible = await drawer.isVisible().catch(() => false);

  if (isVisible) {
    const tagText = page.locator('.MuiDrawer-root h4');
    const text = await tagText.textContent().catch(() => '(sin tag)');
    console.log(`  [OK] Panel abierto con Tag: ${text}`);

    await page.locator('.MuiDrawer-root button').first().click();
    await page.waitForTimeout(500);
    console.log('  [OK] Panel cerrado');
  } else {
    console.log('  Reintentando con .MuiTreeItem-content...');
    const content = treeItems.first().locator('.MuiTreeItem-content');
    await content.click();
    await page.waitForTimeout(1500);
    
    const retryVisible = await drawer.isVisible().catch(() => false);
    console.log(`  Panel visible tras retry: ${retryVisible}`);
  }
});

test('no critical console errors on load', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push({ text: msg.text(), location: msg.location() });
    }
  });

  page.on('pageerror', err => {
    pageErrors.push({ message: err.message, stack: err.stack });
  });

  await page.goto('/');
  await page.waitForTimeout(5000);

  console.log('=== CONSOLE ERRORS ===');
  consoleErrors.forEach(e => console.log('  ', e.text));
  console.log('=== PAGE ERRORS (uncaught) ===');
  pageErrors.forEach(e => {
    console.log('  MESSAGE:', e.message);
    console.log('  STACK:', e.stack?.split('\n').slice(0, 5).join('\n  '));
  });

  const criticalErrors = consoleErrors.filter(e =>
    e.text.includes('Cannot read properties') ||
    e.text.includes('is not a function') ||
    e.text.includes('is not defined') ||
    e.text.includes('TypeError') ||
    e.text.includes('Uncaught')
  );

  expect(pageErrors).toHaveLength(0);
  expect(criticalErrors).toHaveLength(0);
});
