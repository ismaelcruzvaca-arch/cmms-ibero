/**
 * Tests para rxdb.js — push handler de report_templates
 *
 * Cubre:
 * - createReportTemplatePushHandler: handler no-op que retorna []
 *   (los writes van directo a Supabase vía useTemplates hook)
 */
import { describe, it, expect, vi } from 'vitest';

// Mock supabaseClient para evitar error de entorno al importar rxdb.js
vi.mock('../supabaseClient.js', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getSession: vi.fn(),
    },
  },
}));

import { createReportTemplatePushHandler } from '../rxdb.js';

describe('createReportTemplatePushHandler', () => {
  it('retorna array vacío cuando recibe documentos normales', async () => {
    const handler = createReportTemplatePushHandler();
    const result = await handler([{ id: 'test-1', name: 'test', _deleted: false }]);
    expect(result).toEqual([]);
  });

  it('retorna array vacío cuando recibe array vacío', async () => {
    const handler = createReportTemplatePushHandler();
    const result = await handler([]);
    expect(result).toEqual([]);
  });

  it('retorna array vacío cuando recibe documentos eliminados', async () => {
    const handler = createReportTemplatePushHandler();
    const result = await handler([{ id: 'test-2', _deleted: true }]);
    expect(result).toEqual([]);
  });
});
