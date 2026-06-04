# Arquitectura Multi-Site (Multi-Tenant) - CMMS Ibero

Dado el requerimiento de expandir CMMS Ibero a varias plantas de Chocolatera Ibarra, se define la siguiente estrategia corporativa:

## 1. Single Database, Shared Schema
- **Decisión Arquitectónica:** No pasaremos a microservicios ni a esquemas de base de datos separados (`schema-per-tenant`).
- El CMMS seguirá siendo un **Monolito de Datos**. Es decir, todas las plantas comparten las mismas tablas físicas en PostgreSQL (Supabase).

## 2. Aislamiento por `site_id`
- Toda tabla primaria (ej. `assets`, `work_orders`, `storerooms`) DEBE incluir una columna `site_id` de tipo `UUID`.
- Este UUID es la llave maestra para identificar a qué planta pertenece cada registro.

## 3. Row-Level Security (RLS) para Multi-Tenant
- El filtrado de información NO se confía al frontend. El frontend solo consulta la tabla (ej. `SELECT * FROM assets`).
- Supabase se encarga de filtrar, mediante **Políticas RLS**, qué registros devuelve, asegurando que el token JWT del técnico que hizo login (asociado a una planta específica) solo le permita ver las filas cuyo `site_id` coincida con su asignación.
- Los perfiles `ADMIN` podrán tener permisos elevados para realizar `SELECT` globales omitiendo el filtro de `site_id` con el fin de correr reportes corporativos consolidados.

## 4. RxDB (Replica Offline)
- La sincronización pull hacia RxDB en el cliente tomará ventaja automática de este esquema. Como el pull se autentica contra Supabase, el dispositivo móvil solo se descargará y guardará en IndexedDB (Dexie) la información que corresponde a la planta actual, manteniendo la base de datos local liviana.
