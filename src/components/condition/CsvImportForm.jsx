/**
 * CsvImportForm.jsx — Formulario de Importación CSV de Condición
 *
 * Pipeline lineal de importación masiva vía CSV:
 *   1. Selección de archivo → Papa Parse client-side
 *   2. Mapeo de columnas → dropdowns por columna del CSV
 *   3. Validación → feature_key en catálogo, value numérico, fecha parseable
 *   4. Preview → tabla con filas válidas (verde) e inválidas (rojo)
 *   5. Confirmación e ingesta → POST bulk a ingest-condition EF
 *
 * Visible solo para PLANNER/ADMIN.
 */
import { useState, useCallback, useMemo } from 'react';
import {
  Box, Paper, Typography, Button, TextField, MenuItem,
  Alert, AlertTitle, CircularProgress, LinearProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tooltip, Chip, Divider, Grid,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useCsvImport } from '../../hooks/useCsvImport';

// ─── Campos de FeatureSet para mapeo ─────────────────────────────
const TARGET_FIELDS = [
  { value: 'feature_key', label: 'Feature Key (obligatorio)' },
  { value: 'value', label: 'Valor (obligatorio)' },
  { value: 'measured_at', label: 'Fecha/Hora de medición (obligatorio)' },
  { value: 'unit', label: 'Unidad (opcional)' },
  { value: 'asset_id', label: 'ID del Activo (opcional)' },
];

// ─── Estilos de status para badges ───────────────────────────────
const STATE_LABELS = {
  idle: 'Listo',
  parsing: 'Analizando archivo...',
  parsed: 'Archivo cargado',
  mapping: 'Aplicando mapeo...',
  mapped: 'Mapeo aplicado',
  validating: 'Validando filas...',
  validated: 'Validado',
  confirming: 'Ingresando datos...',
  done: 'Completado',
  error: 'Error',
};

export default function CsvImportForm() {
  const {
    state,
    parseResult,
    mapping,
    mappedRows,
    validationSummary,
    ingestProgress,
    loading,
    error,
    handleFileSelected,
    setMapping,
    validateRows,
    confirmImport,
    reset,
  } = useCsvImport();

  const [dragOver, setDragOver] = useState(false);

  // ─── Manejadores de archivo ────────────────────────────────────
  const onFileDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFileSelected(file);
    },
    [handleFileSelected]
  );

  const onFileInput = useCallback(
    (e) => {
      const file = e.target?.files?.[0];
      if (file) handleFileSelected(file);
    },
    [handleFileSelected]
  );

  // ─── Cambio de mapping para una columna ────────────────────────
  const handleMappingChange = useCallback(
    (csvHeader, targetField) => {
      const newMapping = { ...mapping, [csvHeader]: targetField || undefined };
      if (!targetField) delete newMapping[csvHeader];
      setMapping(newMapping);
    },
    [mapping, setMapping]
  );

  // ─── Progress bar para ingesta ─────────────────────────────────
  const ingestPercent = useMemo(() => {
    if (ingestProgress.total === 0) return 0;
    return Math.round((ingestProgress.done / ingestProgress.total) * 100);
  }, [ingestProgress]);

  // ─── Reiniciar ─────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    reset();
  }, [reset]);

  // ─── RENDER: Paso 1 — Selección de archivo ────────────────────
  if (state === 'idle' || state === 'error') {
    return (
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
          Importación CSV de Condición
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Cargue un archivo CSV con datos de condición para ingesta masiva. El sistema validará automáticamente los datos antes de la importación.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={handleReset}>
            <AlertTitle>Error</AlertTitle>
            {error}
          </Alert>
        )}

        <Box
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onFileDrop}
          sx={{
            border: '2px dashed',
            borderColor: dragOver ? 'primary.main' : 'grey.400',
            borderRadius: 2,
            p: 5,
            textAlign: 'center',
            cursor: 'pointer',
            bgcolor: dragOver ? 'action.hover' : 'grey.50',
            transition: 'all 0.2s',
            '&:hover': { borderColor: 'primary.light', bgcolor: 'action.hover' },
          }}
        >
          <CloudUploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
          <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>
            Arrastre el archivo CSV aquí
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            o haga clic para seleccionar. Tamaño máximo: 10 MB.
          </Typography>

          <Button variant="contained" component="label" disabled={loading}>
            Seleccionar Archivo CSV
            <input
              type="file"
              accept=".csv"
              hidden
              onChange={onFileInput}
            />
          </Button>
        </Box>

        <Box sx={{ mt: 3, p: 2, bgcolor: 'info.50', borderRadius: 1 }}>
          <Typography variant="subtitle2" fontWeight={600} color="info.dark" gutterBottom>
            Formato esperado del CSV
          </Typography>
          <Typography variant="body2" color="text.secondary" component="div">
            El archivo debe incluir al menos las columnas:
            <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
              <li><strong>Feature</strong> — nombre del feature (ej: vibration.rms, temperature.bearing)</li>
              <li><strong>Valor</strong> — lectura numérica (ej: 4.2, 75.5)</li>
              <li><strong>Fecha</strong> — fecha/hora de la medición (ISO 8601)</li>
            </ul>
            Los nombres de columna se auto-detectan. Puede ajustar el mapeo en el siguiente paso.
          </Typography>
        </Box>
      </Paper>
    );
  }

  // ─── RENDER: Cargando ─────────────────────────────────────────
  if (state === 'parsing' || state === 'mapping' || state === 'validating') {
    return (
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, textAlign: 'center' }}>
        <CircularProgress sx={{ mb: 2 }} />
        <Typography variant="h6" fontWeight={600}>
          {STATE_LABELS[state]}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {state === 'parsing' && 'Analizando la estructura del archivo CSV...'}
          {state === 'mapping' && 'Aplicando mapeo de columnas...'}
          {state === 'validating' && 'Validando filas contra el catálogo de features...'}
        </Typography>
        {loading && <LinearProgress sx={{ mt: 2, maxWidth: 400, mx: 'auto' }} />}
      </Paper>
    );
  }

  // ─── RENDER: Paso 2 — Mapeo de columnas ───────────────────────
  if (state === 'parsed' || state === 'mapped') {
    const headers = parseResult?.headers || [];

    return (
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Paso 2: Mapeo de Columnas
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Archivo: {parseResult?.file?.name} — {parseResult?.rowCount} filas detectadas
            </Typography>
          </Box>
          <Button variant="outlined" size="small" onClick={handleReset} startIcon={<RestartAltIcon />}>
            Reiniciar
          </Button>
        </Box>

        <Alert severity="info" sx={{ mb: 3 }}>
          Asigne cada columna del CSV a su campo correspondiente. Los campos con <strong>*</strong> son obligatorios.
        </Alert>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell><strong>Columna del CSV</strong></TableCell>
                <TableCell><strong>Mapeo a campo</strong></TableCell>
                <TableCell><strong>Muestra</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {headers.map((header) => {
                const sampleValue = parseResult?.rows?.[0]?.[header] || '';
                const currentMapping = mapping[header] || '';

                return (
                  <TableRow key={header}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {header}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        value={currentMapping}
                        onChange={(e) => handleMappingChange(header, e.target.value)}
                        sx={{ minWidth: 220 }}
                      >
                        <MenuItem value="">
                          <em>— Ignorar columna —</em>
                        </MenuItem>
                        {TARGET_FIELDS.map((tf) => (
                          <MenuItem key={tf.value} value={tf.value}>
                            {tf.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 200 }} noWrap>
                        {sampleValue}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
            {Object.keys(mapping).filter((k) => mapping[k]).length} de {headers.length} columnas mapeadas
          </Typography>
          <Button
            variant="contained"
            onClick={validateRows}
            disabled={loading || Object.keys(mapping).filter((k) => mapping[k]).length === 0}
          >
            Validar Filas
          </Button>
        </Box>
      </Paper>
    );
  }

  // ─── RENDER: Paso 3 — Preview validada ────────────────────────
  if (state === 'validated') {
    return (
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Paso 3: Revisión de Datos
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {parseResult?.file?.name} — {mappedRows.length} filas procesadas
            </Typography>
          </Box>
          <Button variant="outlined" size="small" onClick={handleReset} startIcon={<RestartAltIcon />}>
            Reiniciar
          </Button>
        </Box>

        {/* Resumen */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 4 }}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderColor: 'success.light' }}>
              <CheckCircleIcon color="success" sx={{ fontSize: 32 }} />
              <Typography variant="h5" fontWeight={700} color="success.main">
                {validationSummary.valid}
              </Typography>
              <Typography variant="caption" color="text.secondary">Filas válidas</Typography>
            </Paper>
          </Grid>
          <Grid size={{ xs: 4 }}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderColor: 'error.light' }}>
              <ErrorIcon color="error" sx={{ fontSize: 32 }} />
              <Typography variant="h5" fontWeight={700} color="error.main">
                {validationSummary.invalid}
              </Typography>
              <Typography variant="caption" color="text.secondary">Filas con errores</Typography>
            </Paper>
          </Grid>
          <Grid size={{ xs: 4 }}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="h5" fontWeight={700}>
                {validationSummary.total}
              </Typography>
              <Typography variant="caption" color="text.secondary">Total de filas</Typography>
            </Paper>
          </Grid>
        </Grid>

        {validationSummary.invalid > 0 && (
          <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 2 }}>
            {validationSummary.invalid} filas tienen errores de validación y <strong>no serán importadas</strong>.
            Puede ajustar el mapeo de columnas y re-validar.
          </Alert>
        )}

        {/* Tabla preview */}
        <TableContainer sx={{ maxHeight: 400 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 60 }}>#</TableCell>
                <TableCell>Feature</TableCell>
                <TableCell>Valor</TableCell>
                <TableCell>Unidad</TableCell>
                <TableCell>Fecha</TableCell>
                <TableCell>Activo</TableCell>
                <TableCell>Estado</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mappedRows.map((row) => (
                <TableRow
                  key={row.rowNumber}
                  sx={{
                    bgcolor: row.status === 'valid' ? 'success.50' : 'error.50',
                  }}
                >
                  <TableCell>{row.rowNumber}</TableCell>
                  <TableCell>{row.mappedData?.feature_key || '—'}</TableCell>
                  <TableCell>{row.mappedData?.value || '—'}</TableCell>
                  <TableCell>{row.mappedData?.unit || '—'}</TableCell>
                  <TableCell>{row.mappedData?.measured_at || '—'}</TableCell>
                  <TableCell>{row.mappedData?.asset_id || '—'}</TableCell>
                  <TableCell>
                    {row.status === 'valid' ? (
                      <Chip
                        icon={<CheckCircleIcon />}
                        label="Válida"
                        size="small"
                        color="success"
                        variant="outlined"
                      />
                    ) : (
                      <Tooltip
                        title={row.validationErrors?.join('; ') || ''}
                        arrow
                      >
                        <Chip
                          icon={<ErrorIcon />}
                          label="Error"
                          size="small"
                          color="error"
                          variant="outlined"
                        />
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Acciones */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
          <Button
            variant="outlined"
            onClick={() => setMapping({ ...mapping })}
            disabled={loading}
          >
            Ajustar Mapeo
          </Button>
          <Button
            variant="contained"
            onClick={confirmImport}
            disabled={loading || validationSummary.valid === 0}
            startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null}
          >
            Confirmar e Importar ({validationSummary.valid} filas)
          </Button>
        </Box>
      </Paper>
    );
  }

  // ─── RENDER: Paso 4 — Confirmando ─────────────────────────────
  if (state === 'confirming') {
    return (
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, textAlign: 'center' }}>
        <CircularProgress sx={{ mb: 2 }} />
        <Typography variant="h6" fontWeight={600}>
          Importando datos...
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Enviando {ingestProgress.total} filas válidas al sistema de monitoreo
        </Typography>
        <Box sx={{ maxWidth: 400, mx: 'auto', mt: 2 }}>
          <LinearProgress variant="determinate" value={ingestPercent} sx={{ mb: 1 }} />
          <Typography variant="caption" color="text.secondary">
            {ingestProgress.done} de {ingestProgress.total} procesadas
            {ingestProgress.errors > 0 && ` (${ingestProgress.errors} errores)`}
          </Typography>
        </Box>
      </Paper>
    );
  }

  // ─── RENDER: Paso 5 — Completado ──────────────────────────────
  if (state === 'done') {
    return (
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, textAlign: 'center' }}>
        <CheckCircleIcon color="success" sx={{ fontSize: 64, mb: 2 }} />

        <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>
          Importación Completada
        </Typography>

        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          {ingestProgress.done - ingestProgress.errors} filas importadas exitosamente
          {ingestProgress.errors > 0 && (
            <span style={{ color: '#d32f2f' }}>
              {' '}— {ingestProgress.errors} filas con error
            </span>
          )}
        </Typography>

        <Grid container spacing={2} sx={{ maxWidth: 600, mx: 'auto', mb: 3 }}>
          <Grid size={{ xs: 6 }}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" fontWeight={700} color="success.main">
                {ingestProgress.done - ingestProgress.errors}
              </Typography>
              <Typography variant="caption">Importadas</Typography>
            </Paper>
          </Grid>
          <Grid size={{ xs: 6 }}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" fontWeight={700} color={ingestProgress.errors > 0 ? 'error.main' : 'text.primary'}>
                {ingestProgress.errors}
              </Typography>
              <Typography variant="caption">Errores</Typography>
            </Paper>
          </Grid>
        </Grid>

        <Button variant="contained" onClick={handleReset} startIcon={<RestartAltIcon />}>
          Importar Otro Archivo
        </Button>
      </Paper>
    );
  }

  return null;
}
