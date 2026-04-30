import { test, expect } from '@playwright/test';

test('homepage loads with title', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Módulo de Jerarquía de Activos');
});

test('asset tree component renders', async ({ page }) => {
  await page.goto('/');
  // Verificar que el componente AssetTree existe (MUI Tree View usa role=tree)
  await expect(page.locator('[role="tree"]')).toBeVisible();
});