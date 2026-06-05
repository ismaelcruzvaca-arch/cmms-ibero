# Design: PDF Template Editor — Admin UI (Fase 2)

## Technical Approach

Admin panel de templates con editor CodeMirror 6 en split-pane y preview en vivo vía `resolveTemplate()`. Los writes van directo a Supabase (INSERT con version+1) respetando UNIQUE(code, version). RxDB pull existente replica los cambios automáticamente. El push handler se registra para coexistencia pero la UI admin NO escribe via RxDB.

## Architecture Decisions

### Decision: Write path bypasses RxDB

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Writes via RxDB push | Push handler hace upsert por id, incompatible con versionado INSERT | ❌ |
| Writes via direct Supabase INSERT | Control explícito de version+1, pull replica downstream | ✅ |

**Rationale**: El versionado requiere INSERT controlado con `version+1`. RxDB push handler usa `upsert` por id (UPDATE). Escribir directo a Supabase y dejar que el pull existente replique es más simple y evita escribir push handler complejo. El push handler se registra como handler vacío (devuelve `[]`) para dar señal de que la colección acepta push sin duplicar.

### Decision: Admin tab index dinámico

**Choice**: Insertar "Admin" después de FMEA, antes de Monitoreo, solo para PLANNER/ADMIN.
**Rationale**: Sigue el patrón existente de tabs condicionales por rol en `App.jsx`. `monitoringTabIndex` se recalculó de 3→4 para PLANNER/ADMIN. Con un solo subtab (Templates), no se necesita anidamiento adicional de Tabs.

### Decision: CodeMirror 6 lazy-loaded

**Choice**: `React.lazy(() => import(...))` del wrapper de CodeMirror, solo cuando se navega al editor.
**Rationale**: CodeMirror + lang-json suman ~150KB gzip. Al ser lazy, solo se carga en Admin → Templates → Edit. El componente wrapper (`TemplateEditor`) se exporta normal; el import dinámico va dentro del render condicional.

### Decision: Preview con mock data representativa

**Choice**: Mock data dura (no contexto real) con shape igual a `buildRenderData()`.
**Rationale**: `resolveTemplate()` necesita datos realistas para debug visual. Usar contexto real requeriría fetch async y complica el preview. El mock replica la estructura de `work_order`, `asset`, `labor_records`, `material_requests` con valores de ejemplo.

## Data Flow

```
TemplateManager ──search/paginate──→ supabase.from('report_templates').select()
       │
       ├─ "Edit" → TemplateEditor (lazy CodeMirror)
       │                │
       │                ├─ left pane: CodeMirror 6 (JSON mode) ← 500ms debounce
       │                │
       │                └─ right pane: TemplatePreview
       │                       │
       │                       └─ resolveTemplate(mockData, json) → iframe srcdoc
       │
       ├─ "Save" → supabase INSERT (version+1) → RxDB pull → UI actualizado
       ├─ "Rollback" → set is_active=true en version N-1, false en N
       └─ "Duplicate" → supabase INSERT con code="-copy", version=1

UseTemplates hook ──→ Supabase REST (no RxDB)
                     ──→ RxDB manual insert post-save para feedback inmediato
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/components/pdf/TemplateManager.jsx` | Create | MUI table: search, pagination, toggle, duplicate, row actions |
| `src/components/pdf/TemplateEditor.jsx` | Create | Split pane: CodeMirror JSON (left) + TemplatePreview (right) |
| `src/components/pdf/TemplatePreview.jsx` | Create | iframe srcdoc con resolveTemplate + mock data |
| `src/hooks/useTemplates.js` | Create | `fetchAll`, `create`, `update` (version+1), `duplicate`, `rollback`, `toggleActive` |
| `supabase/migrations/20260605000000_pdf_admin_storage.sql` | Create | Storage bucket `branding` + RLS policies |
| `src/App.jsx` | Modify | Add "Admin" tab (PLANNER/ADMIN), shift monitoringTabIndex |
| `src/lib/rxdb.js` | Modify | Add push handler for `report_templates` (no-op passthrough) |
| `package.json` | Modify | Add `@codemirror/lang-json`, `@codemirror/view`, `@codemirror/state` |

## Interfaces / Contracts

```js
// useTemplates.js — API surface
const useTemplates = () => ({
  fetchAll({ search, page, pageSize }) → { data, total, error },
  create({ code, name, description, template }) → { data, error },
  update(code, { template, name, description }) → { data, error }, // INSERT version+1
  duplicate(code, newCode) → { data, error },                     // COPY with version=1
  rollback(code, targetVersion) → { data, error },                // toggle is_active
  toggleActive(code, version) → { data, error },                  // set is_active = !current
})

// TemplatePreview props
// @param {Object} templateDef — JSON template object (shape: { sections, ... })
// @param {Object} [mockData] — override default mock data
// @returns {string} html — full HTML document from resolveTemplate()
```

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit | `useTemplates` CRUD operations | Mock supabase client, test INSERT/version+1 logic |
| Unit | `TemplatePreview` rendering | Render with mock template, assert iframe srcdoc contains expected HTML |
| Unit | `TemplateEditor` debounce | Simulate rapid typing, assert CodeMirror update fires once after 500ms |
| Integration | Admin tab visibility | Render App with mock PLANNER role, assert "Admin" tab present |
| Integration | Push handler coexistence | Register push handler, verify pull still works after push registration |

## Migration / Rollout

Migration `20260605000000_pdf_admin_storage.sql` crea bucket `branding` (public para lectura de img en preview, INSERT solo PLANNER/ADMIN vía RLS). No afecta datos existentes. Rollback: revertir commit + `supabase migration undo`.

## Open Questions

- [ ] Mock data for preview: ¿misma data para todos los templates o mock por código de template?
- [ ] Branding upload: ¿guardar URL pública del Storage en el template JSONB automáticamente?
