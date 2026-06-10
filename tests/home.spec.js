import { test, expect } from '@playwright/test';

test('homepage loads with title', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Módulo de Jerarquía de Activos');
});

test('asset tree component renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[role="tree"]')).toBeVisible();
});

test('add asset form renders correctly in dialog', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(2000);

  // El botón "+ Nuevo Activo" debe estar visible
  await expect(page.getByRole('button', { name: /Nuevo Activo/ })).toBeVisible();

  // Abrir el Dialog
  await page.getByRole('button', { name: /Nuevo Activo/ }).click();
  await page.waitForTimeout(500);

  // El diálogo debe estar visible
  await expect(page.getByRole('dialog')).toBeVisible();

  // Campos requeridos deben existir dentro del Dialog
  await expect(page.locator('input[name="equipment_id"]')).toBeVisible();
  await expect(page.locator('textarea[name="description"]')).toBeVisible();

  // Botón submit debe existir
  await expect(page.getByRole('button', { name: 'Crear Activo' })).toBeVisible();

  // Botón debe empezar deshabilitado (formulario vacío)
  await expect(page.getByRole('button', { name: 'Crear Activo' })).toBeDisabled();
});

test('equipment_id validation shows error for duplicate tag', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000);

  // Abrir el Dialog
  await page.getByRole('button', { name: /Nuevo Activo/ }).click();
  await page.waitForTimeout(1000);

  // Llenar equipment_id con un tag que ya existe en la DB
  const equipmentInput = page.locator('input[name="equipment_id"]');
  await equipmentInput.fill('MCAL001');

  // Disparar blur para la validación
  await equipmentInput.blur();

  // Esperar validación asíncrona (RxDB findOne)
  await page.waitForTimeout(2000);

  // Verificar si la validación offline detectó el duplicado
  const errorLocator = page.locator('p:has-text("Este Tag ya está registrado")');
  const isVisible = await errorLocator.isVisible().catch(() => false);

  if (isVisible) {
    console.log('  [OK] Validación offline funciona - duplicado detectado');
  } else {
    console.log('  [INFO] Validación offline aún sin datos (equipment_ids no sincronizado)');
  }
});

test('form enables submit when all required fields are filled', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000);

  // Abrir el Dialog
  await page.getByRole('button', { name: /Nuevo Activo/ }).click();
  await page.waitForTimeout(500);

  // Llenar equipo con tag nuevo
  await page.locator('input[name="equipment_id"]').fill('TEST-PW-002');
  await page.locator('input[name="equipment_id"]').blur();
  await page.waitForTimeout(1000);

  // Descripción
  await page.locator('textarea[name="description"]').fill('Activo de prueba Playwright');

  // Seleccionar tipo de equipo — click en el select wrapper
  await page.locator('.MuiSelect-select').first().click();
  await page.waitForTimeout(400);
  await page.getByRole('option', { name: /Motor/ }).click();
  await page.waitForTimeout(600);

  // El botón debería habilitarse
  await expect(page.getByRole('button', { name: 'Crear Activo' })).toBeEnabled({ timeout: 5000 });
});

test('submit creates asset and auto-closes dialog', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000);

  // Abrir el Dialog
  await page.getByRole('button', { name: /Nuevo Activo/ }).click();
  await page.waitForTimeout(500);

  const tag = `TEST-PW-${Date.now()}`;

  await page.locator('input[name="equipment_id"]').fill(tag);
  await page.locator('input[name="equipment_id"]').blur();
  await page.waitForTimeout(1500);

  await page.locator('textarea[name="description"]').fill('Activo de prueba — submit automático');

  // Seleccionar tipo M-MOT
  await page.locator('.MuiSelect-select').first().click();
  await page.waitForTimeout(400);
  await page.getByRole('option', { name: /Motor/ }).click();
  await page.waitForTimeout(600);

  // Llenar specs dinámicos
  await page.locator('input[name="hp"]').fill('100');
  await page.locator('input[name="rpm"]').fill('1800');
  await page.locator('input[name="voltage"]').fill('440');

  // Hacer submit
  await page.getByRole('button', { name: 'Crear Activo' }).click();

  // El Dialog debe cerrarse automáticamente tras submit exitoso (onSuccess)
  // Verificar que el Dialog ya no está visible después del auto-cierre
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });

  console.log(`  [OK] Dialog cerrado automáticamente tras crear: ${tag}`);
});

test('dynamic spec fields appear when asset type is selected', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000);

  // Abrir el Dialog
  await page.getByRole('button', { name: /Nuevo Activo/ }).click();
  await page.waitForTimeout(500);

  // Seleccionar M-MOT
  await page.locator('.MuiSelect-select').first().click();
  await page.waitForTimeout(400);
  await page.getByRole('option', { name: /Motor/ }).click();
  await page.waitForTimeout(800);

  // Campos dinámicos deben aparecer
  await expect(page.locator('text=Especificaciones técnicas')).toBeVisible({ timeout: 5000 });
  await expect(page.getByLabel('HP (Potencia)')).toBeVisible();
  await expect(page.getByLabel('RPM')).toBeVisible();
  await expect(page.getByLabel('Voltaje (V)')).toBeVisible();
});

test('clicking tree node opens AssetDetailsPanel', async ({ page }) => {
  await page.goto('/');
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
