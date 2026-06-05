/**
 * TemplateManager.jsx
 * Panel de administración de templates PDF con tabla, búsqueda y paginación.
 *
 * Props:
 *   onEdit: (template) => void — callback al hacer clic en Editar
 *
 * Estados:
 *   - loading: CircularProgress
 *   - error: Alert
 *   - empty: mensaje "No se encontraron templates"
 *   - success: MUI Table con datos
 *
 * Dependencias externas:
 *   - useTemplates hook para CRUD
 *   - MUI Table, Chip, Switch, IconButton, Tooltip
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TablePagination from '@mui/material/TablePagination';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Chip from '@mui/material/Chip';
import Switch from '@mui/material/Switch';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import SearchIcon from '@mui/icons-material/Search';
import EditIcon from '@mui/icons-material/Edit';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import UndoIcon from '@mui/icons-material/Undo';
import RefreshIcon from '@mui/icons-material/Refresh';

import { useTemplates } from '../../hooks/useTemplates';

/**
 * @param {Object} props
 * @param {(template: Object) => void} [props.onEdit] — Callback al hacer clic en Editar
 */
export default function TemplateManager({ onEdit }) {
  const { fetchAll, duplicate, toggleActive, rollback, loading: hookLoading } = useTemplates();

  // ── Estado local ──
  const [templates, setTemplates] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [actionLoading, setActionLoading] = useState(null); // id de la fila en acción

  const searchTimerRef = useRef(null);

  // ── Load templates ──
  const loadTemplates = useCallback(async (searchTerm, currentPage, currentPageSize) => {
    setLoading(true);
    setError(null);

    const result = await fetchAll({
      search: searchTerm || undefined,
      page: currentPage + 1, // TablePagination es 0-based, Supabase range es 1-based
      pageSize: currentPageSize,
    });

    if (result.error) {
      setError(result.error);
      setTemplates([]);
      setTotal(0);
    } else {
      setTemplates(result.data);
      setTotal(result.total);
    }

    setLoading(false);
  }, [fetchAll]);

  // Carga inicial y cuando cambian page/pageSize
  useEffect(() => {
    loadTemplates(search, page, pageSize);
  }, [page, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Search con debounce 300ms ──
  const handleSearchChange = useCallback((e) => {
    const value = e.target.value;
    setSearch(value);

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    searchTimerRef.current = setTimeout(() => {
      setPage(0);
      loadTemplates(value, 0, pageSize);
    }, 300);
  }, [pageSize, loadTemplates]);

  // ── Change handlers ──
  const handleChangePage = useCallback((_event, newPage) => {
    setPage(newPage);
  }, []);

  const handleChangePageSize = useCallback((event) => {
    const newSize = parseInt(event.target.value, 10);
    setPageSize(newSize);
    setPage(0);
  }, []);

  // ── Toggle active ──
  const handleToggleActive = useCallback(async (tpl) => {
    setActionLoading(tpl.id);
    const result = await toggleActive(tpl.code, tpl.version);
    setActionLoading(null);

    if (result.error) {
      setError(result.error);
    } else {
      // Refrescar la lista
      loadTemplates(search, page, pageSize);
    }
  }, [toggleActive, search, page, pageSize, loadTemplates]);

  // ── Duplicate ──
  const handleDuplicate = useCallback(async (tpl) => {
    setActionLoading(tpl.id);
    const result = await duplicate(tpl.code);
    setActionLoading(null);

    if (result.error) {
      setError(result.error);
    } else {
      // Refrescar la lista
      loadTemplates(search, page, pageSize);
    }
  }, [duplicate, search, page, pageSize, loadTemplates]);

  // ── Rollback ──
  const handleRollback = useCallback(async (tpl) => {
    // Rollback a la versión anterior (versión actual - 1, mínimo 1)
    const targetVersion = Math.max(1, tpl.version - 1);
    setActionLoading(tpl.id);
    const result = await rollback(tpl.code, targetVersion);
    setActionLoading(null);

    if (result.error) {
      setError(result.error);
    } else {
      loadTemplates(search, page, pageSize);
    }
  }, [rollback, search, page, pageSize, loadTemplates]);

  // ── Refresh manual ──
  const handleRefresh = useCallback(() => {
    loadTemplates(search, page, pageSize);
  }, [search, page, pageSize, loadTemplates]);

  // ── Format date ──
  const formatDate = useCallback((dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('es-MX', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  }, []);

  // ── Cleanup timer ──
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  // ── Render ──
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* ── Header: Search + Refresh ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <TextField
          size="small"
          placeholder="Buscar por código o nombre..."
          value={search}
          onChange={handleSearchChange}
          sx={{ flex: 1, maxWidth: 400 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Tooltip title="Recargar">
          <IconButton size="small" onClick={handleRefresh} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* ── Error ── */}
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* ── Loading inicial ── */}
      {loading && templates.length === 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {/* ── Empty ── */}
      {!loading && !error && templates.length === 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <Alert severity="info">
            {search ? 'No se encontraron templates con ese criterio de búsqueda.' : 'No hay templates disponibles.'}
          </Alert>
        </Box>
      )}

      {/* ── Table ── */}
      {templates.length > 0 && (
        <Paper variant="outlined">
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Código</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Nombre</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Versión</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Estado</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Creado</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {templates.map((tpl) => {
                  const isActioning = actionLoading === tpl.id;

                  return (
                    <TableRow key={tpl.id} hover>
                      {/* Code */}
                      <TableCell>
                        <Typography variant="body2" fontWeight={600} fontFamily="monospace">
                          {tpl.code}
                        </Typography>
                      </TableCell>

                      {/* Name */}
                      <TableCell>
                        <Typography variant="body2">{tpl.name}</Typography>
                        {tpl.description && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                            sx={{ maxWidth: 250, display: 'block' }}
                          >
                            {tpl.description}
                          </Typography>
                        )}
                      </TableCell>

                      {/* Version */}
                      <TableCell>
                        <Chip
                          label={`v${tpl.version}`}
                          size="small"
                          color="primary"
                          variant="outlined"
                        />
                      </TableCell>

                      {/* Active */}
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Switch
                            size="small"
                            checked={tpl.is_active}
                            disabled={isActioning}
                            onChange={() => handleToggleActive(tpl)}
                          />
                          <Chip
                            label={tpl.is_active ? 'Activo' : 'Inactivo'}
                            size="small"
                            color={tpl.is_active ? 'success' : 'default'}
                            variant={tpl.is_active ? 'filled' : 'outlined'}
                          />
                        </Box>
                      </TableCell>

                      {/* Created At */}
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {formatDate(tpl.created_at)}
                        </Typography>
                      </TableCell>

                      {/* Actions */}
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {/* Edit */}
                          <Tooltip title="Editar">
                            <span>
                              <IconButton
                                size="small"
                                disabled={isActioning || !tpl.is_active}
                                aria-label="Editar template"
                                onClick={() => onEdit?.(tpl)}
                              >
                                <EditIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>

                          {/* Duplicate */}
                          <Tooltip title="Duplicar">
                            <span>
                              <IconButton
                                size="small"
                                disabled={isActioning}
                                aria-label="Duplicar template"
                                onClick={() => handleDuplicate(tpl)}
                              >
                                <ContentCopyIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>

                          {/* Rollback (solo si hay versión > 1) */}
                          {tpl.version > 1 && (
                            <Tooltip title={`Revertir a v${tpl.version - 1}`}>
                              <span>
                                <IconButton
                                  size="small"
                                  disabled={isActioning || !tpl.is_active}
                                  aria-label="Revertir template"
                                  onClick={() => handleRollback(tpl)}
                                >
                                  <UndoIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )}
                        </Box>

                        {isActioning && (
                          <CircularProgress size={16} sx={{ ml: 1 }} />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {/* ── Pagination ── */}
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={handleChangePage}
            rowsPerPage={pageSize}
            onRowsPerPageChange={handleChangePageSize}
            rowsPerPageOptions={[5, 10, 25, 50]}
            labelRowsPerPage="Filas por página:"
            labelDisplayedRows={({ from, to, count }) =>
              `${from}–${to} de ${count !== -1 ? count : `más de ${to}`}`
            }
          />
        </Paper>
      )}
    </Box>
  );
}
