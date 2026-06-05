/**
 * Tests para FeedbackForm — formulario de feedback
 *
 * Cubre:
 *  - Renderizado de campos del formulario
 *  - Validación de campos requeridos
 *  - Submit exitoso
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// ─── Mock useDiagnosisFeedback ──────────────────────────────────
const { mockUseDiagnosisFeedback } = vi.hoisted(() => {
  return {
    mockUseDiagnosisFeedback: vi.fn(() => ({
      submitFeedback: vi.fn(),
      loading: false,
      error: null,
    })),
  };
});

vi.mock('../../../hooks/useDiagnosisFeedback', () => ({
  default: (...args) => mockUseDiagnosisFeedback(...args),
  useDiagnosisFeedback: (...args) => mockUseDiagnosisFeedback(...args),
}));

// ─── Mock supabase ──────────────────────────────────────────────
vi.mock('../../../lib/supabaseClient', () => {
  const chain = {
    select: vi.fn(),
    order: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.order.mockReturnValue(Promise.resolve({ data: [], error: null }));

  return {
    supabase: {
      from: vi.fn(() => chain),
    },
  };
});

import FeedbackForm from '../FeedbackForm';

describe('FeedbackForm', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renderiza todos los campos del formulario', () => {
    render(<FeedbackForm diagnosisId="diag-001" />);

    // Radio groups should exist
    expect(screen.getByText('Estado del Feedback')).toBeTruthy();
    expect(screen.getByText('Confirmado')).toBeTruthy();
    expect(screen.getByText('Parcial')).toBeTruthy();
    expect(screen.getByText('Rechazado')).toBeTruthy();

    // Text fields should exist (use label text)
    expect(screen.getByLabelText('Componente Afectado')).toBeTruthy();
    expect(screen.getByLabelText('Causa Real')).toBeTruthy();
    expect(screen.getByLabelText('Observación Técnica')).toBeTruthy();
    expect(screen.getByText('¿Recomendación Útil?')).toBeTruthy();
    expect(screen.getByText('Útil')).toBeTruthy();
    expect(screen.getByText('No útil')).toBeTruthy();

    // Submit button
    expect(screen.getByText('Enviar Feedback')).toBeTruthy();
  });

  it('muestra mensaje cuando diagnosisId no está presente', () => {
    render(<FeedbackForm diagnosisId={null} />);

    expect(
      screen.getByText('Seleccioná un diagnóstico para enviar feedback.')
    ).toBeTruthy();
  });

  it('muestra error de validación cuando feedback_status no está seleccionado', async () => {
    render(<FeedbackForm diagnosisId="diag-001" />);

    // Click submit without selecting status
    fireEvent.click(screen.getByText('Enviar Feedback'));

    // The validation error appears both in an Alert and in FormHelperText
    // Use getAllByText and check at least one is rendered
    await waitFor(() => {
      const errors = screen.getAllByText('El estado del feedback es obligatorio');
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('envía el formulario exitosamente cuando los campos requeridos están completos', async () => {
    const submitFn = vi.fn().mockResolvedValue({ id: 'fb-001' });
    mockUseDiagnosisFeedback.mockReturnValue({
      submitFeedback: submitFn,
      loading: false,
      error: null,
    });

    render(<FeedbackForm diagnosisId="diag-001" />);

    // Select feedback status
    fireEvent.click(screen.getByLabelText('Confirmado'));

    // Fill in a text field
    const componentField = screen.getByLabelText('Componente Afectado');
    fireEvent.change(componentField, { target: { value: 'Rodamiento principal' } });

    // Click submit
    fireEvent.click(screen.getByText('Enviar Feedback'));

    await waitFor(() => {
      expect(submitFn).toHaveBeenCalledWith(
        expect.objectContaining({
          diagnosis_id: 'diag-001',
          feedback_status: 'confirmed',
        })
      );
    });

    // After successful submit, the component shows the submitted state
    expect(
      screen.getByText('Feedback registrado correctamente para este diagnóstico.')
    ).toBeTruthy();
  });
});
