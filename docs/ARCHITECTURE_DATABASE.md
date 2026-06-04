# Arquitectura de Base de Datos - CMMS Ibero

Este documento define los estándares inquebrantables para el esquema de PostgreSQL en Supabase.

## 1. Convenciones Generales
- **Naming Convention**: Tablas, columnas y esquemas SIEMPRE en `snake_case`.
- **Primary Keys**: Utilizar `TEXT` o `UUID` uniformemente, pero **NUNCA** mezclarlos en relaciones de Foreign Key. En general, el CMMS usará el formato string (`TEXT`) si viene mapeado directamente de Epicor, o `UUID` (generado por `gen_random_uuid()`) si nace nativamente en el CMMS.
- **Fechas**: Toda marca temporal debe usar `TIMESTAMPTZ` y guardarse en formato UTC (por defecto `now()`).

## 2. Row-Level Security (RLS)
Todas las tablas transaccionales y maestras deben tener RLS habilitado.
- La función estándar `get_user_role()` (definida en `ADR-01`) debe usarse para validar perfiles (ADMIN, PLANNER, TECHNICIAN).
- Nunca dejar políticas "abiertas" `(true)` a public o authenticated sin un scope definido.

## 3. Lógica Transaccional en Base de Datos (PL/pgSQL)
- Toda lógica que garantice integridad referencial compleja o automatización (como el motor PM de `generate_due_preventive_work_orders`) DEBE vivir en PL/pgSQL y gestionarse con triggers o `pg_cron`.
- **Regla:** El Frontend no debe realizar validaciones de integridad complejas; delega la validación de negocio pesada a Postgres.

## 4. Migraciones
- Ningún cambio en la estructura o en RLS debe hacerse directamente desde la consola web de Supabase en Producción.
- TODO cambio se hace creando un archivo `.sql` de migración en la carpeta `supabase/migrations/` (Ej: `20260522000001_nombre_migracion.sql`) y se sube vía Supabase CLI.
