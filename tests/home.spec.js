import { test, expect } from '@playwright/test';

test('homepage loads with title', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Módulo de Jerarquía de Activos');
});

test('asset tree component renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[role="tree"]')).toBeVisible();
});

test('no critical console errors on load', async ({ page }) => {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  
  await page.goto('/');
  await page.waitForTimeout(2000);
  
  const criticalErrors = errors.filter(e => 
    e.includes('Cannot read properties') || 
    e.includes('is not a function') ||
    e.includes('is not defined') ||
    e.includes('TypeError')
  );
  
  expect(criticalErrors).toHaveLength(0);
});