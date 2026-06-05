/**
 * Tests de integración para Admin Tab — visibilidad según rol.
 *
 * Renderiza App con distintos roles mockeados (PLANNER, ADMIN, TECHNICIAN)
 * y verifica la presencia/ausencia del tab "Admin".
 *
 * Mockea dependencias externas para evitar renderizado real de RxDB/Supabase.
 *
 * NOTA: Las rutas de vi.mock son relativas a este archivo (src/components/pdf/__tests__/),
 * NO relativas al archivo que importa (src/App.jsx).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════
// Mocks hoisteados (requerido por vi.mock)
// ═══════════════════════════════════════════════════════════════════
const { mockSupabaseFrom, mockSupabaseAuth } = vi.hoisted(() => ({
  mockSupabaseFrom: vi.fn(),
  mockSupabaseAuth: vi.fn(),
}));

// ═══════════════════════════════════════════════════════════════════
// Mocks de dependencias externas (paths DESDE este archivo hasta el módulo)
// ═══════════════════════════════════════════════════════════════════

// useWorkOrders hook — App: ./hooks/useWorkOrders → desde test: ../../../hooks/useWorkOrders
vi.mock('../../../hooks/useWorkOrders', () => ({
  useWorkOrders: () => ({
    loading: false,
    syncStatus: 'online',
    error: null,
  }),
}));

// useRxDB + useAssets — App: ./lib/rxdb → desde test: ../../../lib/rxdb
vi.mock('../../../lib/rxdb', () => ({
  useRxDB: () => ({
    db: null,
    loading: false,
    error: null,
    syncStatus: 'online',
  }),
  useAssets: () => ({
    assets: [],
    hierarchy: [],
    assetTree: [],
    loading: false,
    error: null,
    syncStatus: 'online',
    refreshAssets: vi.fn(),
  }),
}));

// Supabase client — App: ./lib/supabaseClient → desde test: ../../../lib/supabaseClient
vi.mock('../../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: mockSupabaseAuth,
    },
    from: mockSupabaseFrom,
  },
}));

// Componentes hijos — App: ./components/... → desde test: ../../../components/...
vi.mock('../../../components/AssetTree', () => ({
  default: () => <div data-testid="asset-tree">AssetTree Mock</div>,
}));
vi.mock('../../../components/AssetSearchBar', () => ({
  AssetSearchBar: () => <div data-testid="asset-search">Search Mock</div>,
}));
vi.mock('../../../components/AssetDetailsPanel', () => {
  function AssetDetailsPanel() { return null; }
  return { AssetDetailsPanel };
});
vi.mock('../../../components/SyncStatusIndicator', () => ({
  NavSyncIndicator: () => <span>Sync</span>,
}));
vi.mock('../../../components/QRScannerModal', () => ({
  default: () => null,
}));
vi.mock('../../../pages/MechanicDashboard', () => ({
  default: () => <div>MechanicDashboard Mock</div>,
}));
vi.mock('../../../components/fmea/PlannerBandeja', () => ({
  default: () => <div>PlannerBandeja Mock</div>,
}));
vi.mock('../../../components/condition/ConditionCapture', () => ({
  default: () => <div>ConditionCapture Mock</div>,
}));
vi.mock('../../../components/condition/CsvImportForm', () => ({
  default: () => <div>CsvImportForm Mock</div>,
}));
vi.mock('../../../components/condition/SourceManagementPanel', () => ({
  default: () => <div>SourceManagementPanel Mock</div>,
}));
vi.mock('../../../components/condition/DeadLetterPanel', () => ({
  default: () => <div>DeadLetterPanel Mock</div>,
}));
vi.mock('../../../components/condition/Dashboard', () => ({
  default: () => <div>Dashboard Mock</div>,
}));
vi.mock('../../../components/condition/charts/TrendChart', () => ({
  default: () => <div>TrendChart Mock</div>,
}));
vi.mock('../../../components/condition/DiagnosisPanel', () => ({
  default: () => <div>DiagnosisPanel Mock</div>,
}));
vi.mock('../../../components/condition/RulGauge', () => ({
  default: () => <div>RulGauge Mock</div>,
}));
vi.mock('../../../components/condition/RecommendationCard', () => ({
  default: () => <div>RecommendationCard Mock</div>,
}));
vi.mock('../../../components/condition/PolicyManagementPanel', () => ({
  default: () => <div>PolicyManagementPanel Mock</div>,
}));

// TemplateManager (renderizado dentro del Admin tab)
// App: ./components/pdf/TemplateManager → desde test: ../TemplateManager
vi.mock('../TemplateManager', () => ({
  default: () => <div data-testid="template-manager">TemplateManager Mock</div>,
}));

// TemplateEditor (lazy-loaded, solo si se navega al editor)
// App: ./components/pdf/TemplateEditor → desde test: ../TemplateEditor
vi.mock('../TemplateEditor', () => ({
  default: () => <div data-testid="template-editor">TemplateEditor Mock</div>,
}));

// ═══════════════════════════════════════════════════════════════════
// Helpers: configurar rol del usuario
// ═══════════════════════════════════════════════════════════════════
function mockUserRole(role) {
  mockSupabaseAuth.mockResolvedValue({
    data: {
      session: { user: { id: 'user-123' } },
    },
  });

  mockSupabaseFrom.mockImplementation((table) => {
    if (table === 'user_profiles') {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({
              data: { role },
              error: null,
            }),
          }),
        }),
      };
    }
    // Para otras tablas (report_templates en pull handler mock), retornar vacío
    return {
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
        or: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
// Import del componente bajo prueba
// ═══════════════════════════════════════════════════════════════════
import App from '../../../App';

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════
describe('Admin Tab Visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ───── PLANNER y ADMIN ven el tab ─────
  describe('PLANNER role', () => {
    it('muestra el tab "Admin" cuando el rol es PLANNER', async () => {
      mockUserRole('PLANNER');
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Admin')).toBeDefined();
      });
    });
  });

  describe('ADMIN role', () => {
    it('muestra el tab "Admin" cuando el rol es ADMIN', async () => {
      mockUserRole('ADMIN');
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Admin')).toBeDefined();
      });
    });
  });

  // ───── TECHNICIAN NO ve el tab ─────
  describe('TECHNICIAN role', () => {
    it('NO muestra el tab "Admin" cuando el rol es TECHNICIAN', async () => {
      mockUserRole('TECHNICIAN');
      render(<App />);

      // Esperar a que se haya procesado el rol
      await waitFor(() => {
        // El tab "Admin" NO debe existir
        expect(screen.queryByText('Admin')).toBeNull();
      });
    });
  });

  // ───── Monitoreo de Condición presente para todos ─────
  describe('monitoringTabIndex adjustment', () => {
    it('muestra "Monitoreo de Condición" para PLANNER (con Admin tab antes)', async () => {
      mockUserRole('PLANNER');
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Monitoreo de Condición')).toBeDefined();
      });
    });

    it('muestra "Monitoreo de Condición" para TECHNICIAN (sin Admin tab)', async () => {
      mockUserRole('TECHNICIAN');
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Monitoreo de Condición')).toBeDefined();
      });
    });
  });

  // ───── TemplateManager se renderiza dentro del Admin tab ─────
  describe('Admin tab content', () => {
    it('renderiza TemplateManager al hacer clic en Admin (PLANNER)', async () => {
      mockUserRole('PLANNER');
      render(<App />);

      // Esperar que aparezca el tab Admin
      await waitFor(() => {
        expect(screen.getByText('Admin')).toBeDefined();
      });

      // Hacer clic en Admin tab
      const adminTab = screen.getByText('Admin');
      await adminTab.click();

      await waitFor(() => {
        expect(screen.getByTestId('template-manager')).toBeDefined();
      });
    });
  });

  // ───── Bandeja FMEA visible para PLANNER ─────
  describe('Bandeja FMEA (control)', () => {
    it('muestra "Bandeja FMEA" para PLANNER', async () => {
      mockUserRole('PLANNER');
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Bandeja FMEA')).toBeDefined();
      });
    });

    it('NO muestra "Bandeja FMEA" para TECHNICIAN', async () => {
      mockUserRole('TECHNICIAN');
      render(<App />);

      await waitFor(() => {
        expect(screen.queryByText('Bandeja FMEA')).toBeNull();
      });
    });
  });
});
