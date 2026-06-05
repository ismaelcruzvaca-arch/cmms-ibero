# Proposal: PDF Template Editor — Admin UI (Fase 2)

## Intent

Habilitar a usuarios PLANNER/ADMIN para gestionar y editar templates de reporte PDF desde el panel de administración, sin tocar código ni SQL. La Fase 1 entregó el motor de templates offline (`resolveTemplate`, tabla `report_templates`, hook `useReport`); esta fase agrega la interfaz de administración.

## Scope

### In Scope
- `TemplateManager` — listado con tabla MUI, búsqueda por código/nombre, paginación, toggle activo/inactivo, duplicar
- `TemplateEditor` — split pane: CodeMirror 6 (modo JSON) a izquierda, preview en vivo con debounce 500ms a derecha
- `TemplatePreview` — iframe `srcdoc` que reusa `resolveTemplate` con datos mock para validación visual
- `useTemplates` hook — `fetchAll`, `create`, `update`, `duplicate`, `rollback`, `toggleActive`
- Branding upload — selector drag & drop, subida a Storage bucket `branding/`, preview
- Versionado automático — cada save = INSERT con `version+1`, UNIQUE(code, version); rollback = toggle `is_active`
- Seed `ot-default` editable desde el panel
- Migration: bucket `branding` con RLS policies
- RxDB: push handler para `report_templates` (actualmente solo pull)
- Tests del panel admin (vitest + testing-library)
- Ruta: nueva tab "Admin" en `App.jsx` (solo PLANNER/ADMIN) con subtabs "Templates"

### Out of Scope
- Builder visual drag-and-drop de secciones (Fase 3)
- Edge Function `generate-pdf` (Fase 3)
- Reportes avanzados (Fase 4)
- Branding global compartido entre templates

## Capabilities

### New Capabilities
- `template-admin-ui`: Interfaz de listado, editor y preview de templates para roles PLANNER/ADMIN
- `template-branding`: Upload y gestión de assets de branding (logo) en Storage

### Modified Capabilities
- None — primera espec para templates

## Approach

CodeMirror 6 con `@codemirror/lang-json` para edición del JSONB del template. Split pane con `TemplatePreview` a la derecha renderizando via `resolveTemplate()` + datos mock en un iframe `srcdoc` con debounce 500ms. Los cambios se persisten directo a Supabase via `useTemplates` hook (push handler en RxDB). El versionado usa UNIQUE(code, version) — cada modificación INSERTA una nueva fila con `version+1` y marca la anterior como `is_active=false`. Rollback = toggle `is_active` de la versión anterior.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/components/pdf/TemplateManager.jsx` | New | Listado CRUD con tabla MUI |
| `src/components/pdf/TemplateEditor.jsx` | New | Split pane editor + preview |
| `src/components/pdf/TemplatePreview.jsx` | New | Preview en iframe con resolveTemplate |
| `src/hooks/useTemplates.js` | New | CRUD hook contra Supabase |
| `supabase/migrations/*_pdf_admin_storage.sql` | New | Bucket branding + RLS |
| `src/App.jsx` | Modified | Nueva tab "Admin" solo PLANNER/ADMIN |
| `src/lib/rxdb.js` | Modified | Push handler para report_templates |
| `package.json` | Modified | + @codemirror/lang-json, @codemirror/view, @codemirror/state |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| CodeMirror 6 bundle size | Medium | Import dinámico lazy; solo disponible en Admin |
| Preview con datos mock puede diferir de datos reales | Low | Preview usa `resolveTemplate` real; mock data representativa |
| Push handler conflict con replicación pull | Low | report_templates es pull-only actual; push debe convivir sin duplicar escrituras |

## Rollback Plan

Revertir el commit. La migration del bucket `branding` no afecta datos existentes. Los templates existentes en producción (ot-default) persisten sin cambios.

## Dependencies

- `@codemirror/lang-json` (latest)
- `@codemirror/view`, `@codemirror/state` (bundled con lang-json)
- Bucket `branding` en Supabase Storage (creado via migration)

## Success Criteria

- [ ] PLANNER/ADMIN puede crear, editar, duplicar y desactivar templates desde la UI
- [ ] Preview en vivo refleja cambios del JSON con ≤500ms de latencia
- [ ] Subida de logo a Storage y preview en el editor
- [ ] Versionado incremental: cada save crea nueva versión, rollback togglea activo
- [ ] Tests pasan en vitest (TemplateEditor, useTemplates, TemplateManager)
