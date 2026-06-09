# Release Checklist — CMMS Ibero

## Pre-Release

### 1. Code Quality Gates
- [ ] CI pasa: `npm run lint` sin errores
- [ ] Tests unitarios pasan: `npm test` (288+ tests)
- [ ] Coverage thresholds se cumplen: `npm run test:coverage`
- [ ] Build exitoso: `npm run build` sin errores CJS de recharts
- [ ] Tests E2E pasan: `npm run test:e2e`
- [ ] Mutation tests pasan: `npx stryker run` (threshold ≥50%)

### 2. Version Bump & Changelog
- [ ] Determinar el tipo de bump (`patch`, `minor`, `major`) según [SemVer](https://semver.org/)
- [ ] Actualizar `version` en `package.json`
- [ ] Actualizar `CHANGELOG.md` con los cambios del release

### 3. ⚠️ Desactivar Auto-Deploy de Vercel
- [ ] Ir a Vercel Dashboard → Settings → Git → **Deshabilitar "Auto-deploy on main branch"**
- [ ] Esto evita que Vercel deployee antes de la verificación manual

---

## Deploy

### 4. Vercel Deploy
- [ ] Hacer merge del PR a `main`
- [ ] Deploy manual desde Vercel Dashboard o CLI:
  ```bash
  npx vercel --prod
  ```
- [ ] Verificar que el deploy se complete sin errores

### 5. Smoke Tests (Post-Deploy)
- [ ] Login funciona (auth con Supabase)
- [ ] Dashboard carga con datos correctos
- [ ] Work Orders: listar, crear, editar, cambiar estado
- [ ] PDF: generar y descargar reporte
- [ ] RxDB: datos offline se sincronizan al volver online

### 6. Post-Deploy Monitoring
- [ ] **Sentry**: verificar que no hay errores nuevos en las últimas 15 minutos
- [ ] **Supabase**: revisar Edge Functions y logs de base de datos
- [ ] Notificar al equipo en el canal de comunicaciones (Slack/Teams)

---

## Post-Release

### 7. Git Tag & Push
```bash
git tag v<version>
git push origin v<version>
```

### 8. ⚠️ Reactivar Auto-Deploy de Vercel
- [ ] Ir a Vercel Dashboard → Settings → Git → **Re-habilitar "Auto-deploy on main branch"**
- [ ] No olvidar este paso o PRs futuros no se deployarán automáticamente
