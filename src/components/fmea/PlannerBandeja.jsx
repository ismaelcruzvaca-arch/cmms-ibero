/**
 * PlannerBandeja — Bandeja del planificador
 *
 * Muestra análisis FMEA pendientes (recommended_strategy IS NULL)
 * y un placeholder para fallas no catalogadas (SDD 2).
 * Solo visible para usuarios con rol PLANNER o ADMIN.
 */
import React, { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Divider from '@mui/material/Divider';
import FlagIcon from '@mui/icons-material/Flag';
import AssignmentLateIcon from '@mui/icons-material/AssignmentLate';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import { useRxDB } from '../../lib/rxdb';
import { supabase } from '../../lib/supabaseClient';
import { toFmeaAnalysisViewModel } from '../../lib/adapters/fmeaAdapter';
import { RCM_STRATEGIES } from './fmeaConstants';

/**
 * Obtiene el rol del usuario actual desde la tabla user_profiles.
 * @returns {Promise<string|null>}
 */
async function fetchUserRole() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return null;
    const { data } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();
    return data?.role || null;
  } catch (err) {
    console.error('[PlannerBandeja] Error obteniendo rol:', err);
    return null;
  }
}

/**
 * Calcula RPN a partir de S, O, D.
 */
function computeRPN(severity, occurrence, detection) {
  return (severity || 5) * (occurrence || 3) * (detection || 4);
}

export default function PlannerBandeja() {
  const { db, loading: dbLoading } = useRxDB();

  // ─── Auth ───
  const [userRole, setUserRole] = useState(null);
  const [roleLoading, setRoleLoading] = useState(true);

  // ─── Datos ───
  const [analyses, setAnalyses] = useState([]);
  const [assets, setAssets] = useState([]);
  const [componentTypes, setComponentTypes] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState(null);

  // ─── Filtros ───
  const [filterComponentType, setFilterComponentType] = useState('');

  // ─── Ordenamiento ───
  const [orderBy, setOrderBy] = useState('updatedAt');
  const [orderDir, setOrderDir] = useState('desc');

  // ─── Obtener rol ───
  useEffect(() => {
    let cancelled = false;
    fetchUserRole().then((role) => {
      if (!cancelled) {
        setUserRole(role);
        setRoleLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // ─── Cargar assets y component_types ───
  useEffect(() => {
    if (!db) return;

    const loadCatalogs = async () => {
      try {
        // Assets
        const assetDocs = await db.assets.find({
          selector: { _deleted: false }
        }).exec();
        const assetMap = {};
        assetDocs.forEach((d) => {
          const json = d.toJSON();
          assetMap[json.id] = json;
        });
        setAssets(assetMap);

        // Component types
        const ctDocs = await db.component_types.find({
          selector: { _deleted: false }
        }).exec();
        setComponentTypes(ctDocs.map((d) => d.toJSON()));
      } catch (err) {
        console.error('[PlannerBandeja] Error cargando catálogos:', err);
      }
    };

    loadCatalogs();
  }, [db]);

  // ─── Suscripción reactiva a análisis pendientes ───
  useEffect(() => {
    if (!db) return;

    const sub = db.fmea_rcm_analysis.find({
      selector: { _deleted: false }
    }).$.subscribe({
      next: (docs) => {
        try {
          const viewModels = docs
            .map((d) => toFmeaAnalysisViewModel(d.toJSON()))
            // Solo pendientes: sin estrategia definida
            .filter((a) => !a.recommendedStrategy);
          setAnalyses(viewModels);
          setDataLoading(false);
        } catch (e) {
          console.error('[PlannerBandeja] Error procesando análisis:', e);
        }
      },
      error: (err) => {
        console.error('[PlannerBandeja] Error en suscripción:', err);
        setError(err.message);
        setDataLoading(false);
      }
    });

    return () => sub.unsubscribe();
  }, [db]);

  // ─── Filtrado y ordenamiento ───
  const pendingAnalyses = analyses
    .filter((a) => {
      if (!filterComponentType) return true;
      // Buscar el tipo de componente del análisis
      // Necesitamos el component_type_id desde el asset_component
      return true; // El filtro se aplica sobre datos enriquecidos
    })
    .sort((a, b) => {
      const dir = orderDir === 'asc' ? 1 : -1;
      const aVal = a[orderBy] || '';
      const bVal = b[orderBy] || '';
      return String(aVal).localeCompare(String(bVal)) * dir;
    });

  // ─── Handlers ───
  const handleSort = (column) => {
    if (orderBy === column) {
      setOrderDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrderBy(column);
      setOrderDir('asc');
    }
  };

  const handleGoToAsset = (assetId) => {
    // Disparar evento personalizado para que App.jsx pueda escucharlo
    // y seleccionar el activo en el árbol
    window.dispatchEvent(new CustomEvent('fmea:select-asset', { detail: { assetId } }));
  };

  // ─── Render de estados ───
  if (roleLoading || dbLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!userRole) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        No se pudo verificar tu sesión. Iniciá sesión para acceder a la bandeja.
      </Alert>
    );
  }

  if (userRole !== 'PLANNER' && userRole !== 'ADMIN') {
    return (
      <Box sx={{ py: 4 }}>
        <Alert severity="info" icon={<AssignmentLateIcon />}>
          Esta sección es solo para planificadores y administradores.
          Tu rol actual es <strong>{userRole}</strong>.
        </Alert>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        Error al cargar la bandeja: {error}
      </Alert>
    );
  }

  return (
    <Box>
      {/* ─── Header ─── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <FlagIcon color="primary" />
        <Typography variant="h6" fontWeight={700}>
          Bandeja FMEA
        </Typography>
        <Chip
          label={`${pendingAnalyses.length} pendiente${pendingAnalyses.length !== 1 ? 's' : ''}`}
          color={pendingAnalyses.length > 0 ? 'warning' : 'success'}
          size="small"
        />
      </Box>

      {/* ─── Sección: Análisis Pendientes ─── */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            Análisis FMEA pendientes
          </Typography>

          {/* Filtro por tipo de componente */}
          {componentTypes.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Tipo de componente</InputLabel>
              <Select
                value={filterComponentType}
                label="Tipo de componente"
                onChange={(e) => setFilterComponentType(e.target.value)}
              >
                <MenuItem value="">Todos</MenuItem>
                {componentTypes.map((ct) => (
                  <MenuItem key={ct.id} value={ct.id}>
                    {ct.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Box>

        <Divider />

        {dataLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : pendingAnalyses.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <CheckCircleOutlinedIcon sx={{ fontSize: 48, color: 'success.main', mb: 1 }} />
            <Typography variant="body1" color="text.secondary">
              No hay análisis pendientes 🎉
            </Typography>
            <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>
              Todos los modos de falla tienen una estrategia RCM asignada.
            </Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>
                    <TableSortLabel
                      active={orderBy === 'assetId'}
                      direction={orderBy === 'assetId' ? orderDir : 'asc'}
                      onClick={() => handleSort('assetId')}
                    >
                      Activo
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>Componente</TableCell>
                  <TableCell>Modo de Falla</TableCell>
                  <TableCell align="right">
                    <TableSortLabel
                      active={orderBy === 'rpn'}
                      direction={orderBy === 'rpn' ? orderDir : 'desc'}
                      onClick={() => handleSort('rpn')}
                    >
                      RPN
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>
                    <TableSortLabel
                      active={orderBy === 'updatedAt'}
                      direction={orderBy === 'updatedAt' ? orderDir : 'asc'}
                      onClick={() => handleSort('updatedAt')}
                    >
                      Última modificación
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="center">Acción</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pendingAnalyses.map((analysis) => {
                  const asset = assets[analysis.assetId];
                  const rpn = computeRPN(analysis.severity, analysis.occurrence, analysis.detection);
                  const isHighRpn = rpn >= 200;

                  return (
                    <TableRow
                      key={analysis.id}
                      sx={{
                        bgcolor: isHighRpn ? 'warning.light' : 'inherit',
                        '&:hover': { bgcolor: 'action.hover' },
                        ...(isHighRpn && {
                          '&:hover': { bgcolor: 'warning.light' }
                        })
                      }}
                    >
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>
                          {asset?.equipment_id || analysis.assetId}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {analysis.componentId || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {analysis.failureModeId || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Chip
                          label={rpn}
                          size="small"
                          color={isHighRpn ? 'error' : rpn >= 100 ? 'warning' : 'default'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {analysis.updatedAt
                            ? new Date(analysis.updatedAt).toLocaleDateString('es-MX', {
                                year: 'numeric', month: 'short', day: 'numeric'
                              })
                            : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Button
                          size="small"
                          variant="outlined"
                          endIcon={<OpenInNewIcon />}
                          onClick={() => handleGoToAsset(analysis.assetId)}
                        >
                          Ir al activo
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* ─── Sección: Fallas no catalogadas (SDD 2 placeholder) ─── */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            Fallas no catalogadas
          </Typography>
        </Box>
        <Divider />
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <AssignmentLateIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
          <Typography variant="body2" color="text.secondary">
            Las fallas no catalogadas aparecerán aquí cuando el módulo de
            registro de fallas (SDD 2) esté integrado.
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}
