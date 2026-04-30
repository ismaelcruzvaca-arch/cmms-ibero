# Code Review Rules - cmms-ibero

## General (React/Vite)
REJECT if:
- Hardcoded secrets or credentials in `.env` or source files
- `any` type in TypeScript (if migrating)
- Empty catch blocks (silent error handling)
- Code duplication (violates DRY)
- `console.log` in production code (use proper logging)

## JavaScript/React
REJECT if:
- `import * as React` → use named imports: `import { useState, useEffect }`
- Missing PropTypes or TypeScript interfaces for component props
- Inline styles instead of CSS modules or Tailwind classes
- Hardcoded URLs for API calls (use env variables)

PREFER:
- Functional components with hooks
- Semantic HTML over divs
- Named exports over default exports
- Environment variables for configuration

## Response Format
FIRST LINE must be exactly:
STATUS: PASSED
or
STATUS: FAILED

If FAILED, list: `file:line - rule violated - issue`