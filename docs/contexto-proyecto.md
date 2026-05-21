# Proyecto CMMS Ibero – Documento de Contexto Completo

## Resumen Ejecutivo
Se está construyendo un sistema de gestión de mantenimiento (CMMS) personalizado para la planta de Chocolatera Ibarra. El proyecto se enfoca inicialmente en el módulo de jerarquía de activos, para luego extenderse a órdenes de trabajo, formatos de inspección, monitoreo de condición y gestión predictiva de refacciones. El sistema se conecta con el ERP Epicor Kinetic (solo lectura/escritura a través de DMT y APIs) y utiliza tecnologías modernas de desarrollo web y móvil.

## Participante Principal
- **Ismael Cruz** (ingeniero de mantenimiento, desarrollador principal, experiencia previa en IBM Maximo en Bimbo).

## Herramientas de Desarrollo Configuradas
- **Entorno:** Windows (computadora del trabajo y computadora de casa). Se desea memoria compartida entre ambas máquinas.
- **IDE:** Antigravity (versión de escritorio con terminal PowerShell integrada).
- **IA asistente:** OpenCode dentro de Antigravity, gestionado por `gentle-ai` v1.24.2.
- **Memoria persistente local:** Engram (base de datos SQLite en `~/.config/engram/engram.db`).
- **Sincronización de memoria entre equipos:** Engram Cloud (pendiente de activación).
- **Control de versiones:** Git + GitHub (repositorio `https://github.com/ismaelcruzvaca-arch/cmms-ibero.git`, rama principal `main`).
- **Gestor de paquetes:** Scoop (instalado para el usuario actual, no a nivel de administrador).
- **Node.js:** 20.x LTS instalado vía Scoop (ruta en `%USERPROFILE%\scoop\apps\nodejs\current`). Se solucionó problema de PATH manualmente.

## Stack Tecnológico del Sistema CMMS
- **Frontend:** React 18 con Vite, Material UI (MUI), React Router.
- **Base de datos principal:** PostgreSQL alojada en Supabase (proyecto `cmms_ibero`).
- **Backend externo futuro:** Node.js (Express) para implementar el patrón Outbox y sincronización con Epicor.
- **Captura offline futura:** Firebase Firestore (sincronización cliente-servidor).
- **Integración con ERP:** Epicor Kinetic vía API REST (previa habilitación por el equipo de IT) y en una primera fase mediante plantillas DMT (Data Management Tool).

## Módulos Planificados del Sistema

1.  **Módulo de Jerarquía de Activos (en desarrollo)**
    - Crear un inventario de activos con estructura multinivel (Sistema → Subsistema → Componente) que Epicor no soporta de forma nativa.
    - Capturar atributos técnicos específicos por tipo de activo (presión, caudal, etc.) que alimentarán el módulo predictivo.
    - Llenar automáticamente los campos estándar de Equipment en Epicor durante la creación de activos.

2.  **Módulo de Órdenes de Trabajo (OTs)**
3.  **Módulo de Formatos de Inspección Digitales**
4.  **Módulo de Monitoreo de Condición y Predictivo**
5.  **Módulo de Gestión de Refacciones y Almacén**
6.  **Módulo de Integración y Sincronización con Epicor (Transversal)**

## Modelo de Base de Datos (Esquema en Supabase)

### Tablas creadas
1.  **`asset_types`**: Catálogo de tipos de activo.
2.  **`assets`**: Activos individuales (`equipment_id`, `description`, `asset_type_id`, `criticality`, etc.).
3.  **`asset_hierarchy`**: Relaciones jerárquicas. Campos: `parent_id` (FK a `assets.id`), `child_id` (FK a `assets.id`), `hierarchy_level` (int). 
4.  **`outbox_messages`**: Para patrón Outbox de mensajes hacia Epicor.

## Estado Actual del Desarrollo (al 29/04/2026)
1.  **Frontend React:** Proyecto Vite creado en `cmms-frontend-react`. Se ha desarrollado el componente inicial `App.jsx` que muestra una tabla MUI con los activos.
2.  **Próximo componente a desarrollar:** `AssetTree.jsx` – Visualización de jerarquía de activos usando `TreeView` de MUI.

## Decisiones de Diseño Importantes
- **Base de datos:** PostgreSQL (Supabase) con jerarquía manejada en tabla de asociación propia (`asset_hierarchy`) para no modificar el esquema de Epicor.
- **Sincronización con Epicor:** La primera fase usará DMT (archivos CSV).
- **Modo offline:** Se usará Firebase Firestore exclusivamente para la captura de datos en campo.