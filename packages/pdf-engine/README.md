# @cmms/pdf-engine

Motor de templates PDF para CMMS Ibero. JS puro, 0 dependencias externas.
Corre idéntico en Deno (Edge Functions) y browser (Vite).

## Importar

```ts
import {
  resolveTemplate,
  validateTemplate,
  renderSection,
  evaluateCondition,
  DEFAULT_TEMPLATE_OT,
  DEFAULT_CSS,
} from "@cmms/pdf-engine";
```

## API

| Export | Descripción |
|--------|-------------|
| `resolveTemplate(template, data, options?)` | Renderiza un template completo a HTML |
| `validateTemplate(template)` | Valida estructura del template, retorna `{valid, errors}` |
| `renderSection(section, data, options?)` | Renderiza una sección individual a HTML |
| `evaluateCondition(expr, context)` | Evalúa una condición booleana contra datos |
| `DEFAULT_TEMPLATE_OT` | Template offline de respaldo para Órdenes de Trabajo |
| `DEFAULT_CSS` | CSS @media print completo para reportes A4 |
| `DEFAULT_PIPES` | 10 pipes transformadores (uppercase, date, number, etc.) |
| `SECTION_RENDERERS` | 13 renderers por tipo de sección |

## Publicar

```bash
npx jsr publish
```
