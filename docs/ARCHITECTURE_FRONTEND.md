# Arquitectura Frontend - CMMS Ibero

Este documento establece las reglas de React y el manejo de estado para prevenir inconsistencias sintomáticas.

## 1. Reglas Inquebrantables de React
- **NUNCA** llamar a `setState` sincrónicamente en el cuerpo de un componente o directamente dentro de un render.
- **NUNCA** usar `useEffect` para forzar un re-render o mutar estados intermedios que podrían derivarse limpiamente de los props o del hook nativo. (Los `useEffect` con `setState` causan cascadas de renders).
- **Código Limpio:** Prohibido dejar "Dead Code". Variables no usadas (ej. `tradIdx`) e imports no usados (ej. `ErrorOutlineIcon`) deben eliminarse antes de hacer commit. ESLint es ley.

## 2. Manejo de Estado (Global vs Local)
- **Local:** `useState` se reserva exclusivamente para UI efímera (menús abiertos, inputs en tránsito, booleanos de carga).
- **Persistente (Offline-First):** La *ÚNICA* fuente de verdad del dominio es **RxDB**. Para acceder a datos de equipos o trabajos, se debe utilizar invariablemente el hook `useRxDB()` y suscribirse a la colección.
- No se deben duplicar datos de la base de datos en un contexto de React o Zustand. Se hace *query* directo a RxDB y la reactividad del hook hará el re-render.

## 3. Lógica Contradictoria en Formularios
- Si un input está `disabled` en el formulario (por estado o permisos), su valor **NO** debe ser inyectado ni modificado en el payload del método `UPDATE` hacia RxDB.
- Solo los campos explícitamente manipulables se mutan.
