# CMMS Ibero - Arquitectura del Sistema

## 1. Visión General

**Stack Tecnológico:**
- Frontend: React 19 + Vite + Material UI
- Base de Datos Local: RxDB + Dexie (Offline-First)
- Backend/Sync: Supabase (PostgreSQL)
- Testing: Playwright (E2E)
- Code Review: GGA (Gentleman Guardian Angel)

---

## 2. Arquitectura Offline-First

### Patrón de Sincronización

```
┌─────────────────┐     ┌─────────────────┐
│   Cliente      │     │   Servidor      │
│   (RxDB)       │     │  (Supabase)     │
│                │     │                 │
│  [Local DB]    │◄───►│ [PostgreSQL]   │
│    Dexie       │     │                 │
└─────────────────┘     └─────────────────┘
        │                       │
        ▼                       ▼
   Pull Handler          Trigger PostgreSQL
   Push Handler          (EXTRACT(EPOCH) * 1000)
```

### Componentes de RxDB

| Archivo | Propósito |
|---------|-----------|
| `src/lib/rxdb.js` | Inicialización + Pull/Push handlers |
| `src/hooks/useWorkOrders.js` | Hook React para datos reactivos |
| `src/components/SyncStatusIndicator.jsx` | Indicador visual de estado |

---

## 3. Schema de Work Order

### RxSchema (Cliente)

```javascript
{
  version: 0,
  primaryKey: 'id',
  properties: {
    id: { type: 'string', maxLength: 50 },
    equipment_id: { type: 'string', maxLength: 50 },
    description: { type: 'string' },
    location: { type: 'string', maxLength: 100 },
    criticality: { type: 'string', enum: ['A', 'B', 'C'] },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    assigned_to: { type: 'string' },
    scheduled_date: { type: 'string' },
    completed_date: { type: 'string' },
    created_at: { type: 'string' },
    _deleted: { type: 'boolean' },
    _last_modified: { type: 'number' }
  }
}
```

### Tabla PostgreSQL (Servidor)

```sql
CREATE TABLE work_orders (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL,
  description TEXT,
  location VARCHAR(100),
  criticality VARCHAR(1) CHECK (criticality IN ('A','B','C')),
  status VARCHAR(20) DEFAULT 'pending',
  priority VARCHAR(20),
  assigned_to TEXT,
  scheduled_date TIMESTAMP,
  completed_date TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  _deleted BOOLEAN DEFAULT FALSE,
  _last_modified BIGINT DEFAULT 0
);
```

---

## 4. Triggers de Sincronización

### Trigger de Timestamp (PostgreSQL)

```sql
CREATE OR REPLACE FUNCTION update_last_modified()
RETURNS TRIGGER AS $$
BEGIN
  NEW._last_modified := (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER work_orders_modified
  BEFORE INSERT OR UPDATE ON work_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_last_modified();
```

---

## 5. Protocolo de Réplica

### Pull Handler (Cliente → Servidor)
- Filtro por `assigned_to` (escalabilidad)
- Paginación compuesta: `_last_modified` + `id`
- Trae TODOS los registros (incluye cancelados)

### Push Handler (Servidor → Cliente)
- Estrategia: Last-Write-Wins (sobreescritura ciega)
- Upserts: Envía data sin `_last_modified` (trigger lo maneja)
- Soft Deletes: Marca `_deleted: true` en servidor

### Riesgos Conocidos

| Riesgo | Descripción | Mitigación |
|--------|-------------|------------|
| Query out-of-bounds | Si WO se reasigna, no se descarga | TODO: Eventos de cambio de scope |
| Conflictos | Ediciones concurrentes no detectadas | Aceptado para MVP |
| Fantasmas locales | Registros eliminados en servidor persisten | Pull trae `_deleted: true` |

---

## 6. Configuración de Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  }
}
```

---

## 7. GitHub Actions (E2E)

Workflow en `.github/workflows/e2e.yml`:
- Ejecuta `npm run test:e2e` en cada push a main
- Instala Playwright browsers automáticamente

---

## 8. Historial de Versiones

| Versión | Fecha | Cambios |
|---------|-------|---------|
| 1.0.0 | 2026-04-30 | Implementación inicial Offline-First con RxDB |
| 0.x | 2026-04-29 | Build funcional, Supabase integrado |

---

*Documento actualizado: 2026-04-30*