/**
 * ReportsPage.jsx
 * Main reports page with tab-based report type selector, filter bar, and export.
 *
 * Tabs: Histórico | KPIs | Horas Labor | Materiales
 * Filters per tab:
 *   - Histórico: asset selector + date range
 *   - KPIs: asset selector + date range
 *   - Horas Labor: date range + technician selector
 *   - Materiales: asset selector + date range + part number
 *
 * Uses useSearchParams to reflect filter state in URL.
 * Exposes widget refs for html2canvas capture.
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import { useUrlParams } from '../hooks/useUrlParams';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFnsV3';
import { es } from 'date-fns/locale';
import { useAssets } from '../lib/rxdb';
import { supabase } from '../lib/supabaseClient';
import { useMaintenanceHistory } from '../hooks/useMaintenanceHistory';
import { useKpiMetrics } from '../hooks/useKpiMetrics';
import { useLaborHoursReport } from '../hooks/useLaborHoursReport';
import { useMaterialsConsumed } from '../hooks/useMaterialsConsumed';
import { useComplianceReport } from '../hooks/useComplianceReport';
import { useChecklistEvidence } from '../hooks/useChecklistEvidence';
import MaintenanceHistoryReport from '../components/reports/MaintenanceHistoryReport';
import KpiDashboardReport from '../components/reports/KpiDashboardReport';
import LaborHoursReport from '../components/reports/LaborHoursReport';
import MaterialsConsumedReport from '../components/reports/MaterialsConsumedReport';
import ComplianceReport from '../components/reports/ComplianceReport';
import ChecklistEvidenceReport from '../components/reports/ChecklistEvidenceReport';
import ReportExportButton from '../components/reports/ReportExportButton';
import './ReportsPage.css';

// ─── Date helpers ───────────────────────────────────────────────
function getDefaultStart() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

function getDefaultEnd() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useUrlParams();

  // ── Tabs ──
  const reportType = searchParams.get('type') || 'historico';
  const setReportType = (val) => {
    const next = new URLSearchParams(searchParams);
    next.set('type', val);
    setSearchParams(next);
  };

  // ── Filters from URL ──
  const assetId = searchParams.get('asset') || '';
  const startDate = searchParams.get('start') || getDefaultStart();
  const endDate = searchParams.get('end') || getDefaultEnd();
  const techId = searchParams.get('tech') || '';
  const partNum = searchParams.get('part_num') || '';
  const templateId = searchParams.get('template') || '';

  const setFilter = (key, val) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, val);
    else next.delete(key);
    setSearchParams(next);
  };

  // ── Assets & Technicians ──
  const { assets } = useAssets();
  const [technicians, setTechnicians] = useState([]);
  const [templates, setTemplates] = useState([]);

  useEffect(() => {
    supabase
      .from('user_profiles')
      .select('id, name')
      .in('role', ['TECHNICIAN', 'PLANNER'])
      .order('name')
      .then(({ data }) => setTechnicians(data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    supabase
      .from('checklist_templates')
      .select('id, code')
      .order('code')
      .then(({ data }) => setTemplates(data || []))
      .catch(() => {});
  }, []);

  // ── Widget refs for html2canvas ──
  const chartRef = useRef(null);
  const tableRef = useRef(null);
  const metricsRef = useRef(null);
  const materialsChartRef = useRef(null);
  const materialsTableRef = useRef(null);
  const complianceRef = useRef(null);
  const checklistRef = useRef(null);

  // Build widget list based on active report
  const widgetRefs = useMemo(() => {
    const refs = [];
    if (chartRef.current) {
      refs.push({ id: 'chart', label: 'Gráfico', ref: chartRef, selected: true });
    }
    if (tableRef.current) {
      refs.push({ id: 'table', label: 'Tabla de detalle', ref: tableRef, selected: true });
    }
    if (metricsRef.current) {
      refs.push({ id: 'metrics', label: 'Tarjetas de métricas', ref: metricsRef, selected: true });
    }
    if (materialsChartRef.current) {
      refs.push({ id: 'chart', label: 'Gráfico', ref: materialsChartRef, selected: true });
    }
    if (materialsTableRef.current) {
      refs.push({ id: 'table', label: 'Tabla de detalle', ref: materialsTableRef, selected: true });
    }
    if (complianceRef.current) {
      refs.push({ id: 'compliance', label: 'Cumplimiento', ref: complianceRef, selected: true });
    }
    if (checklistRef.current) {
      refs.push({ id: 'checklists', label: 'Checklists', ref: checklistRef, selected: true });
    }
    return refs;
  }, [reportType]);

  // ── Hooks ──
  const maintHistory = useMaintenanceHistory({
    assetId: assetId || null,
    startDate: startDate ? `${startDate}T00:00:00` : null,
    endDate: endDate ? `${endDate}T23:59:59` : null,
  });

  const kpiMetrics = useKpiMetrics({
    assetId: assetId || null,
    startDate: startDate ? `${startDate}T00:00:00` : null,
    endDate: endDate ? `${endDate}T23:59:59` : null,
  });

  const laborHours = useLaborHoursReport({
    techId: techId || null,
    startDate: startDate ? `${startDate}T00:00:00` : null,
    endDate: endDate ? `${endDate}T23:59:59` : null,
  });

  const materials = useMaterialsConsumed({
    assetId: assetId || null,
    partNum: partNum || null,
    startDate: startDate ? `${startDate}T00:00:00` : null,
    endDate: endDate ? `${endDate}T23:59:59` : null,
  });

  const compliance = useComplianceReport({
    assetId: assetId || null,
    startDate: startDate ? `${startDate}T00:00:00` : null,
    endDate: endDate ? `${endDate}T23:59:59` : null,
    techId: techId || null,
  });

  const checklists = useChecklistEvidence({
    startDate: startDate ? `${startDate}T00:00:00` : null,
    endDate: endDate ? `${endDate}T23:59:59` : null,
    techId: techId || null,
    templateId: templateId || null,
  });

  // ── Render report content ──
  const renderReport = () => {
    switch (reportType) {
      case 'kpi':
        return (
          <>
            <Box ref={metricsRef} data-widget-id="kpi-metric-cards" className="report-widget">
              <KpiDashboardReport
                {...kpiMetrics}
                onRetry={kpiMetrics.refetch}
              />
            </Box>
          </>
        );
      case 'labor':
        return (
          <Box ref={tableRef} data-widget-id="labor-hours-table" className="report-widget">
            <LaborHoursReport
              {...laborHours}
              onRetry={laborHours.refetch}
            />
          </Box>
        );
      case 'materiales':
        return (
          <>
            <Box ref={materialsChartRef} data-widget-id="materials-chart" className="report-widget">
              <MaterialsConsumedReport
                records={materials.records}
                loading={materials.loading}
                error={materials.error}
                onRetry={materials.refetch}
              />
            </Box>
          </>
        );
      case 'compliance':
        return (
          <Box ref={complianceRef} data-widget-id="compliance" className="report-widget">
            <ComplianceReport
              permits={compliance.permits}
              lotoRecords={compliance.lotoRecords}
              certs={compliance.certs}
              loading={compliance.loading}
              error={compliance.error}
              sectionErrors={compliance.sectionErrors}
              onRetry={compliance.refetch}
            />
          </Box>
        );
      case 'checklists':
        return (
          <Box ref={checklistRef} data-widget-id="checklists" className="report-widget">
            <ChecklistEvidenceReport
              instances={checklists.instances}
              summary={checklists.summary}
              loading={checklists.loading}
              error={checklists.error}
              onRetry={checklists.refetch}
            />
          </Box>
        );
      default: // 'historico'
        return (
          <>
            <Box ref={chartRef} data-widget-id="maintenance-history-chart" className="report-widget">
              <MaintenanceHistoryReport
                {...maintHistory}
                onRetry={maintHistory.refetch}
              />
            </Box>
          </>
        );
    }
  };

  // Determine if export should be disabled
  const hasNoData =
    (reportType === 'historico' && maintHistory.wos.length === 0 && !maintHistory.loading) ||
    (reportType === 'kpi' && kpiMetrics.monthly.length === 0 && !kpiMetrics.loading) ||
    (reportType === 'labor' && laborHours.records.length === 0 && !laborHours.loading) ||
    (reportType === 'materiales' && materials.records.length === 0 && !materials.loading) ||
    (reportType === 'compliance' &&
      compliance.permits.length === 0 &&
      compliance.lotoRecords.length === 0 &&
      compliance.certs.length === 0 &&
      !compliance.loading) ||
    (reportType === 'checklists' &&
      checklists.instances.length === 0 &&
      !checklists.loading);

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={es}>
      <Box className="report-container">
        <Typography variant="h6" fontWeight="700" sx={{ mb: 2 }}>
          Reportes
        </Typography>

        {/* Report type tabs */}
        <Tabs
          value={reportType}
          onChange={(e, v) => setReportType(v)}
          sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="Histórico" value="historico" />
          <Tab label="KPIs" value="kpi" />
          <Tab label="Horas Labor" value="labor" />
          <Tab label="Materiales" value="materiales" />
          <Tab label="Compliance" value="compliance" />
          <Tab label="Checklists" value="checklists" />
        </Tabs>

        {/* Filter bar */}
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }} className="report-filters">
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Asset selector (for historico, kpi, materiales and compliance) */}
            {(reportType === 'historico' || reportType === 'kpi' || reportType === 'materiales' || reportType === 'compliance') && (
              <TextField
                select
                label="Activo"
                value={assetId}
                onChange={(e) => setFilter('asset', e.target.value)}
                size="small"
                sx={{ minWidth: 200 }}
              >
                <MenuItem value="">Todos los activos</MenuItem>
                {(assets || []).map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    {a.name || a.equipment_id || a.id}
                  </MenuItem>
                ))}
              </TextField>
            )}

            {/* Technician selector (for labor hours, compliance, and checklists) */}
            {(reportType === 'labor' || reportType === 'compliance' || reportType === 'checklists') && (
              <TextField
                select
                label="Técnico"
                value={techId}
                onChange={(e) => setFilter('tech', e.target.value)}
                size="small"
                sx={{ minWidth: 200 }}
              >
                <MenuItem value="">Todos los técnicos</MenuItem>
                {technicians.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.name || t.id}
                  </MenuItem>
                ))}
              </TextField>
            )}

            {/* Template selector (for checklists) */}
            {reportType === 'checklists' && (
              <TextField
                select
                label="Template"
                value={templateId}
                onChange={(e) => setFilter('template', e.target.value)}
                size="small"
                sx={{ minWidth: 200 }}
              >
                <MenuItem value="">Todos los templates</MenuItem>
                {templates.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.code || t.id}
                  </MenuItem>
                ))}
              </TextField>
            )}

            {/* Part number filter (for materiales) */}
            {reportType === 'materiales' && (
              <TextField
                label="N° de parte"
                value={partNum}
                onChange={(e) => setFilter('part_num', e.target.value)}
                size="small"
                sx={{ minWidth: 160 }}
              />
            )}

            {/* Date range */}
            <TextField
              label="Desde"
              type="date"
              value={startDate}
              onChange={(e) => setFilter('start', e.target.value)}
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 160 }}
            />
            <TextField
              label="Hasta"
              type="date"
              value={endDate}
              onChange={(e) => setFilter('end', e.target.value)}
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 160 }}
            />

            {/* Export button */}
            <ReportExportButton
              widgetRefs={widgetRefs}
              disabled={hasNoData}
              filename={`reporte-${reportType}-${startDate}-${endDate}.pdf`}
            />
          </Box>
        </Paper>

        {/* Report content */}
        <Paper variant="outlined" sx={{ p: 3 }} className="report-widget">
          {renderReport()}
        </Paper>
      </Box>
    </LocalizationProvider>
  );
}
