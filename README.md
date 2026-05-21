# CMMS Ibero - Sistema de Gestión de Mantenimiento

> Sistema de gestión de mantenimiento computarizado (CMMS) para Chocolatera Ibero - построенный с использованием React, RxDB offline-first y Supabase.

[![Stack](https://img.shields.io/badge/Stack-React%20+%20RxDB%20+%20Supabase-blue)](https://github.com/ismaelcruzvaca-arch/cmms-ibero)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Build](https://img.shields.io/badge/Build-Passing-brightgreen)](https://github.com/ismaelcruzvaca-arch/cmms-ibero/actions)

---

## 1. Visión General del Proyecto

**CMMS Ibero** es un sistema de gestión de mantenimiento computarizado diseñado para la planta de Chocolatera Ibarra. El sistema gestiona activos, órdenes de trabajo y sincroniza datos entre el cliente offline y el backend en Supabase.

### Stack Tecnológico

| Capa | Tecnología |
|------|------------|
| Frontend | React 19 + Vite + Material UI |
| Estado Local | RxDB + Dexie (Offline-First) |
| Backend | Supabase (PostgreSQL) |
| Testing | Playwright E2E |
| CI/CD | GitHub Actions |
| Memoria | Engram |

---

## 2. Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────┐
│                    Cliente                         │
│  ┌─────────────────────────────────────────────┐   │
│  │           React App (Vite + MUI)           │   │
│  └─────────────────────────────────────────────┘   │
│                         │                        │
│                         ▼                        │
│  ┌─────────────────────────────────────────────┐   │
│  │        RxDB (IndexedDB via Dexie)         │   │
│  │                                             │   │
│  │  • work_orders                              │   │
│  │  • assets                                  │   │
│  │  • asset_hierarchy                        │   │
│  └─────────────────────────────────────────────┘   │
│                       │                        │
│     Pull/Push       │                        │
│     Replication    │                        │
└───────────────────┼──────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────┐
│                      Servidor                        │
│  ┌───────────────────────────────────────────────┐   │
│  │            Supabase (PostgreSQL)              │   │
│  │  • work_orders                              │   │
│  │  • assets                                  │   │
│  │  • asset_hierarchy                        │   │
│  └───────────────────────────────────────────────┘   │
└────────────────────────────────────────────���──────────┘
```

---

## 3. Estructura del Proyecto

```
cmms-ibero/
├── src/
│   ├── components/
│   │   ├── AssetTree.jsx          # Árbol de jerarquía de activos
│   │   └── SyncStatusIndicator.jsx # Indicador de estado de sincronización
│   ├── hooks/
│   │   └── useWorkOrders.js        # Hook para órdenes de trabajo
│   ├── lib/
│   │   ├── rxdb.js              # Configuración RxDB offline-first
│   │   └── supabaseClient.js    # Cliente Supabase
│   ├── App.jsx                  # Componente principal
│   └── main.jsx                  # Punto de entrada
├── docs/
│   ├── ARCHITECTURE.md           # Documentación de arquitectura
│   └── contexto-proyecto.md     # Contexto del proyecto
├── tests/
│   └── home.spec.js              # Tests E2E con Playwright
├── sql/
│   └── trigger-work_orders.sql    # Triggers PostgreSQL
├── package.json
├── vite.config.js
└── playwright.config.js
```

---

## 4. Colecciones y Schemas

### 4.1 Work Orders

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | Identificador único (PK) |
| `equipment_id` | string | ID del equipo asociado |
| `description` | string | Descripción de la orden |
| `location` | string | Ubicación física |
| `criticality` | enum(A,B,C) | Criticidad |
| `status` | enum | Estado (pending/in_progress/completed/cancelled) |
| `priority` | enum | Prioridad (low/medium/high/critical) |
| `assigned_to` | string | Técnico asignado |
| `scheduled_date` | string | Fecha programada |
| `completed_date` | string | Fecha de completado |
| `created_at` | string | Fecha de creación |
| `updated_at` | number | Timestamp de última modificación |
| `deleted` | boolean | Soft delete |

### 4.2 Assets

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | Identificador único (PK) |
| `equipment_id` | string | ID de equipo en Epicor |
| `description` | string | Descripción |
| `asset_type_id` | string | Tipo de activo |
| `serial_number` | string | Número de serie |
| `status` | string | Estado |
| `location` | string | Ubicación |
| `site` | string | Sitio |
| `resource_group` | string | Grupo de recursos |
| `criticality` | enum(A,B,C) | Criticidad |
| `manufacturer` | string | Fabricante |
| `model_number` | string | Modelo |

### 4.3 Asset Hierarchy

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | Identificador único (PK) |
| `parent_id` | string | ID del activo padre |
| `child_id` | string | ID del activo hijo |
| `hierarchy_level` | number | Nivel en la jerarquía |
| `created_at` | string | Fecha de creación |
| `updated_at` | number | Timestamp |
| `deleted` | boolean | Soft delete |

---

## 5. Configuración y Desarrollo

### Requisitos Previos

- Node.js 20.x LTS
- Bun (opcional, para faster installs)
- Supabase CLI (para desarrollo local)

### Instalación

```bash
# Instalar dependencias
npm install

# o con bun
bun install
```

### Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
VITE_SUPABASE_URL=tu_supabase_url
VITE_SUPABASE_ANON_KEY=tu_supabase_anon_key
```

### Scripts Disponibles

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Iniciar servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run preview` | Preview del build |
| `npm run test:e2e` | Ejecutar tests E2E |
| `npm run test:e2e:ui` | Tests E2E con UI |

### Entwicklung Server

```bash
npm run dev
```

El app estará disponible en `http://localhost:5173`.

---

## 6. Sincronización Offline-First

### Patron de Réplica

El sistema usa **RxDB** para sincronización bidireccional:

- **Pull**: Trae cambios del servidor (Supabase) al cliente
- **Push**: Envía cambios locales al servidor
- **Live Replication**: Sincronización en tiempo real

### Pull Handler

```javascript
const pullHandler = async (checkpoint, batchSize) => {
  //Trae documentos modificados después del checkpoint
  const docs = await supabase
    .from(tableName)
    .select('*')
    .order('updated_at', { ascending: true })
    .gt('updated_at', checkpoint.lastModified)
    .limit(batchSize);
    
  return { documents: docs, checkpoint: newCheckpoint };
};
```

### Push Handler

```javascript
const pushHandler = async (docs) => {
  // Usa upsert para inserts y updates
  await supabase.from(tableName).upsert(docs, { onConflict: 'id' });
  return [];
};
```

### Resolución de Conflictos

- **Estrategia**: Last-Write-Wins (LWW)
- **Soft Deletes**: Los documentos no se borran, se marcan como `deleted: true`

---

## 7. Componentes UI

### AssetTree

Componente de visualización de jerarquía de activos con:

- Árbol expandible/colapsable
- Indicadores de criticidad (A=Rojo, B=Naranja, C=Verde)
- Información de ubicación
- Botón de refresh para forzar sincronización

### SyncStatusIndicator

Indicador visual del estado de sincronización:

- **offline**: Sin conexión
- **syncing**: Sincronizando
- **online**: Sincronizado

---

## 8. Integración con Epicor

El sistema se integra con **Epicor Kinetic** (ERP de la empresa):

- Primera fase: DMT (Data Management Tool) para importación masiva
- Futuro: API REST nativa de Epicor
- Patrón Outbox para可靠的 messaging

---

## 9.部署

### Vercel (Frontend)

El proyecto está configurado para desplegarse en Vercel:

```bash
vercel deploy
```

### Render (Backend API)

Pendiente de configuración.

---

## 10. Contributing

1. Fork el repo
2. Crea una rama (`git checkout -b feature/nueva-caracteristica`)
3. Commit tus cambios (`git commit -m 'Add nueva caracteristica'`)
4. Push a la rama (`git push origin feature/nueva-caracteristica`)
5. Abre un Pull Request

### Reglas de Código

- Usar componentes funcionales de React
- Usar `const`/`let`, nunca `var`
- Preferir arrow functions para callbacks
- No usar tipos `any` en TypeScript
- Usar async/await en lugar de then/catch

---

## 11. Links de Interés

- [Documentación de RxDB](https://rxdb.dev/)
- [Supabase Docs](https://supabase.com/docs)
- [Material UI](https://mui.com/)
- [Playwright](https://playwright.dev/)

---

## 12. Licencia

MIT License - ver [LICENSE](LICENSE) para detalles.

---

*Documento actualizado: Mayo 2026*