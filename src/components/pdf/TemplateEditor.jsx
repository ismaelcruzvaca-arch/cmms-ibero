/**
 * TemplateEditor.jsx
 * Editor de templates PDF con split-pane: CodeMirror 6 (JSON) a la izquierda,
 * TemplatePreview a la derecha con debounce de 500ms.
 *
 * Incluye sección de branding upload (drag-and-drop a Supabase Storage).
 *
 * Props:
 *   template: object|null — template a editar (null para nuevo)
 *   onSaveComplete: (saved) => void — callback post-guardado
 *   brandingUrl: string? — URL pública de branding existente
 *
 * Estados:
 *   loading — CodeMirror inicializando
 *   ready — editor + preview funcionales
 *   error — JSON inválido
 *   saving — guardando en progreso
 *
 * Nota: Se carga vía React.lazy() para mantener CodeMirror fuera del bundle principal.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Snackbar from '@mui/material/Snackbar';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import { useTheme } from '@mui/material/styles';
import SaveIcon from '@mui/icons-material/Save';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import { EditorView, lineNumbers, highlightActiveLine, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';

import { useTemplates } from '../../hooks/useTemplates';
import { supabase } from '../../lib/supabaseClient';
import TemplatePreview from './TemplatePreview';

// ─────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────
const DEBOUNCE_MS = 500;
const BRANDING_BUCKET = 'branding';
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

// ─────────────────────────────────────────────────────
// CodeMirror custom keymap: Tab → 2 espacios
// ─────────────────────────────────────────────────────
const tabKeymap = keymap.of([
  {
    key: 'Tab',
    run: (view) => {
      view.dispatch({
        changes: { from: view.state.selection.main.head, insert: '  ' },
      });
      return true;
    },
  },
]);

// ─────────────────────────────────────────────────────
// Sub-componente: CodeMirrorEditor
// ─────────────────────────────────────────────────────
function CodeMirrorEditor({ value, onChange, darkMode }) {
  const editorRef = useRef(null);
  const viewRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const darkModeRef = useRef(darkMode);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { darkModeRef.current = darkMode; }, [darkMode]);

  // Inicializar EditorView una sola vez
  useEffect(() => {
    if (!editorRef.current) return;

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      tabKeymap,
      json(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current?.(update.state.doc.toString());
        }
      }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '13px' },
        '.cm-scroller': {
          overflow: 'auto',
          fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
        },
        '.cm-content': {
          fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
          padding: '8px 0',
        },
        '.cm-line': { padding: '0 8px' },
      }),
      EditorView.contentAttributes.of({ spellcheck: 'false' }),
    ];

    // Tema oscuro
    if (darkModeRef.current) {
      extensions.push(
        EditorView.theme({
          '&': { backgroundColor: '#1e1e1e', color: '#d4d4d4' },
          '&.cm-focused': { outline: 'none' },
          '.cm-gutters': {
            backgroundColor: '#252526',
            color: '#858585',
            borderRight: '1px solid #333',
          },
          '.cm-activeLine': { backgroundColor: '#2a2d2e' },
          '.cm-activeLineGutter': { backgroundColor: '#2a2d2e' },
          '.cm-cursor': { borderLeftColor: '#aeafad' },
          '.cm-selectionBackground, .cm-selectionBackground.cm-focused': {
            backgroundColor: '#264f78',
          },
        }, { dark: true }),
      );
    } else {
      extensions.push(
        EditorView.theme({
          '&': { backgroundColor: '#fff', color: '#333' },
          '&.cm-focused': { outline: 'none' },
          '.cm-gutters': {
            backgroundColor: '#f7f7f7',
            color: '#999',
            borderRight: '1px solid #e0e0e0',
          },
          '.cm-activeLine': { backgroundColor: '#e8f2ff' },
          '.cm-activeLineGutter': { backgroundColor: '#e8f2ff' },
        }),
      );
    }

    const view = new EditorView({
      state: EditorState.create({
        doc: valueRef.current,
        extensions,
      }),
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Sincronizar value externo solo si cambió
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const current = view.state.doc.toString();
    if (value !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <Box
      ref={editorRef}
      sx={{
        height: '100%',
        overflow: 'hidden',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
      }}
    />
  );
}

// ─────────────────────────────────────────────────────
// Sub-componente: BrandingUpload
// ─────────────────────────────────────────────────────
function BrandingUpload({ templateCode, currentLogoUrl, onLogoUpdate }) {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(currentLogoUrl || null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setPreviewUrl(currentLogoUrl || null);
  }, [currentLogoUrl]);

  const validateFile = useCallback((file) => {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(ext)) {
      return 'Formato no soportado. Usá PNG, JPG, SVG o WEBP.';
    }
    if (file.size > MAX_FILE_SIZE) {
      return 'El archivo supera el límite de 2MB.';
    }
    return null;
  }, []);

  const uploadFile = useCallback(async (file) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setUploading(true);

    try {
      const filePath = `${templateCode}/${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from(BRANDING_BUCKET)
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type,
        });

      if (uploadError) {
        setError(`Error al subir: ${uploadError.message}`);
        return;
      }

      const { data: { publicUrl } } = supabase.storage
        .from(BRANDING_BUCKET)
        .getPublicUrl(filePath);

      setPreviewUrl(publicUrl);
      onLogoUpdate?.(publicUrl);
    } catch (err) {
      setError(err?.message || 'Error al subir el archivo');
    } finally {
      setUploading(false);
    }
  }, [templateCode, validateFile, onLogoUpdate]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files?.length) {
      uploadFile(files[0]);
    }
  }, [uploadFile]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleFileSelect = useCallback((e) => {
    const files = e.target?.files;
    if (files?.length) {
      uploadFile(files[0]);
    }
  }, [uploadFile]);

  const handleRemove = useCallback(() => {
    setPreviewUrl(null);
    setError(null);
    onLogoUpdate?.(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onLogoUpdate]);

  return (
    <Box>
      {/* Drop zone */}
      <Box
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        sx={{
          border: '2px dashed',
          borderColor: dragOver ? 'primary.main' : error ? 'error.main' : 'divider',
          borderRadius: 2,
          p: 3,
          textAlign: 'center',
          cursor: 'pointer',
          backgroundColor: dragOver ? 'action.hover' : 'transparent',
          transition: 'all 0.2s',
          '&:hover': {
            borderColor: 'primary.light',
            backgroundColor: 'action.hover',
          },
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.svg,.webp"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          aria-label="Seleccionar archivo de logo"
        />

        {uploading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={32} />
            <Typography variant="body2" color="text.secondary">
              Subiendo logo...
            </Typography>
          </Box>
        ) : previewUrl ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
            <Box
              component="img"
              src={previewUrl}
              alt="Logo preview"
              sx={{
                maxHeight: 80,
                maxWidth: 200,
                objectFit: 'contain',
                borderRadius: 1,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              Arrastrá una imagen o hacé clic para reemplazar
            </Typography>
            <Button
              size="small"
              color="error"
              variant="outlined"
              startIcon={<DeleteIcon />}
              onClick={(e) => { e.stopPropagation(); handleRemove(); }}
            >
              Quitar logo
            </Button>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <CloudUploadIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
            <Typography variant="body2" color="text.secondary">
              Arrastrá un logo acá o hacé clic para seleccionar
            </Typography>
            <Typography variant="caption" color="text.disabled">
              PNG, JPG, SVG o WEBP — máximo 2MB
            </Typography>
          </Box>
        )}
      </Box>

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────────────
// Componente principal: TemplateEditor
// ─────────────────────────────────────────────────────
export default function TemplateEditor({ template, onSaveComplete, brandingUrl }) {
  const theme = useTheme();
  const darkMode = theme.palette.mode === 'dark';
  const { update, create, loading: saving } = useTemplates();

  const isNew = !template;

  // Inicializar JSON desde template o vacío
  const initialJson = useMemo(() => {
    if (template?.template) {
      return JSON.stringify(template.template, null, 2);
    }
    return JSON.stringify({ sections: [] }, null, 2);
  }, [template]);

  const [jsonText, setJsonText] = useState(initialJson);
  const [debouncedJson, setDebouncedJson] = useState(initialJson);
  const [jsonError, setJsonError] = useState(null);
  const [editorReady, setEditorReady] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [templateName, setTemplateName] = useState(template?.name || '');
  const [templateDescription, setTemplateDescription] = useState(template?.description || '');
  const [brandingLogoUrl, setBrandingLogoUrl] = useState(
    brandingUrl || template?.template?.branding?.logo_url || null,
  );

  const debounceTimerRef = useRef(null);

  // Resetear cuando cambia template
  useEffect(() => {
    const json = template?.template
      ? JSON.stringify(template.template, null, 2)
      : JSON.stringify({ sections: [] }, null, 2);
    setJsonText(json);
    setDebouncedJson(json);
    setJsonError(null);
    setTemplateName(template?.name || '');
    setTemplateDescription(template?.description || '');
    setBrandingLogoUrl(brandingUrl || template?.template?.branding?.logo_url || null);
  }, [template, brandingUrl]);

  // Debounce 500ms: actualizar preview
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedJson(jsonText);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [jsonText]);

  // Validar JSON en tiempo real
  useEffect(() => {
    try {
      const parsed = JSON.parse(jsonText);
      if (parsed && typeof parsed === 'object') {
        setJsonError(null);
      } else {
        setJsonError('El JSON debe ser un objeto');
      }
    } catch (e) {
      setJsonError(e.message);
    }
  }, [jsonText]);

  // Marcar editor como listo después del primer render
  useEffect(() => {
    setEditorReady(true);
  }, []);

  // Manejar cambio en CodeMirror
  const handleEditorChange = useCallback((newText) => {
    setJsonText(newText);
  }, []);

  // Manejar logo actualizado desde BrandingUpload
  const handleLogoUpdate = useCallback((url) => {
    setBrandingLogoUrl(url);
    // Actualizar el JSON para incluir branding.logo_url
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed.branding) {
        parsed.branding = {};
      }
      if (url) {
        parsed.branding.logo_url = url;
      } else {
        delete parsed.branding.logo_url;
        // Limpiar branding si está vacío
        if (Object.keys(parsed.branding).length === 0) {
          delete parsed.branding;
        }
      }
      const updated = JSON.stringify(parsed, null, 2);
      setJsonText(updated);
      setDebouncedJson(updated);
    } catch {
      // Si el JSON es inválido, ignorar la actualización
    }
  }, [jsonText]);

  // Guardar
  const handleSave = useCallback(async () => {
    if (jsonError) {
      setSnackbar({ open: true, message: 'Corregí los errores de sintaxis antes de guardar.', severity: 'error' });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      setSnackbar({ open: true, message: 'JSON inválido. Revisá la sintaxis.', severity: 'error' });
      return;
    }

    if (isNew) {
      if (!templateName.trim()) {
        setSnackbar({ open: true, message: 'El nombre del template es requerido.', severity: 'error' });
        return;
      }
      // Crear nuevo template con código generado
      const code = templateName.trim().toLowerCase().replace(/\s+/g, '-');
      const result = await create({
        code,
        name: templateName.trim(),
        description: templateDescription.trim() || null,
        template: parsed,
      });

      if (result.error) {
        setSnackbar({ open: true, message: `Error al guardar: ${result.error}`, severity: 'error' });
        return;
      }

      setSnackbar({ open: true, message: 'Template creado exitosamente.', severity: 'success' });
      onSaveComplete?.(result.data);
    } else {
      // Actualizar template existente (INSERT version+1)
      const updatePayload = { template: parsed };
      if (templateName !== template.name) updatePayload.name = templateName;
      if (templateDescription !== (template.description || '')) {
        updatePayload.description = templateDescription || null;
      }

      const result = await update(template.code, updatePayload);

      if (result.error) {
        setSnackbar({ open: true, message: `Error al guardar: ${result.error}`, severity: 'error' });
        return;
      }

      setSnackbar({ open: true, message: `Guardado como versión ${result.data.version}.`, severity: 'success' });
      onSaveComplete?.(result.data);
    }
  }, [jsonText, jsonError, isNew, template, templateName, templateDescription, update, create, onSaveComplete]);

  // Template object para preview (desde debouncedJson)
  const previewTemplate = useMemo(() => {
    try {
      const parsed = JSON.parse(debouncedJson);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.sections)) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }, [debouncedJson]);

  const hasJsonError = jsonError !== null;

  // ── Render ──
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      {/* ── Toolbar ── */}
      <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => onSaveComplete?.()}
          aria-label="Volver a lista de templates"
        >
          Volver
        </Button>

        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
          {isNew ? (
            <>
              <TextField
                size="small"
                label="Nombre del template"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                sx={{ minWidth: 250 }}
                error={!templateName.trim() && jsonError !== null}
              />
              <TextField
                size="small"
                label="Descripción (opcional)"
                value={templateDescription}
                onChange={(e) => setTemplateDescription(e.target.value)}
                sx={{ minWidth: 300 }}
              />
            </>
          ) : (
            <>
              <Chip
                label={template.code}
                size="small"
                color="primary"
                variant="outlined"
                sx={{ fontFamily: 'monospace' }}
              />
              <Typography variant="body2" fontWeight={600}>
                {template.name}
              </Typography>
              <Chip
                label={`v${template.version}`}
                size="small"
                color="default"
                variant="outlined"
              />
              {template.description && (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {template.description}
                </Typography>
              )}
            </>
          )}
        </Box>

        <Button
          variant="contained"
          size="small"
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
          onClick={handleSave}
          disabled={saving || (!isNew && !jsonError === null)}
          aria-label="Guardar template"
        >
          {saving ? 'Guardando...' : 'Guardar'}
        </Button>
      </Paper>

      {/* ── Cuerpo principal: split pane ── */}
      <Box sx={{ display: 'flex', gap: 2, flex: 1, minHeight: 0 }}>
        {/* Left pane: Editor JSON */}
        <Paper variant="outlined" sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="subtitle2" fontWeight={600}>
              Editor JSON
            </Typography>
            {hasJsonError && (
              <Typography variant="caption" color="error">
                Error de sintaxis
              </Typography>
            )}
          </Box>
          <Box sx={{ flex: 1, overflow: 'hidden', p: 0.5 }}>
            {editorReady ? (
              <CodeMirrorEditor
                value={jsonText}
                onChange={handleEditorChange}
                darkMode={darkMode}
              />
            ) : (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <CircularProgress size={24} />
              </Box>
            )}
          </Box>
          {/* Barra de estado / error */}
          <Box sx={{ px: 2, py: 0.5, borderTop: 1, borderColor: 'divider' }}>
            {hasJsonError ? (
              <Typography variant="caption" color="error">
                {jsonError}
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary">
                JSON válido · {jsonText.length} caracteres
              </Typography>
            )}
          </Box>
        </Paper>

        {/* Right pane: Preview + Branding */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          {/* Preview */}
          <Paper variant="outlined" sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="subtitle2" fontWeight={600}>
                Vista previa
              </Typography>
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto' }}>
              {hasJsonError ? (
                <Box sx={{ p: 3 }}>
                  <Alert severity="error">
                    <Typography variant="subtitle2" gutterBottom>
                      Error de sintaxis JSON
                    </Typography>
                    <Typography variant="body2">
                      Revisá el error en la barra inferior del editor.
                    </Typography>
                  </Alert>
                </Box>
              ) : previewTemplate ? (
                <TemplatePreview template={previewTemplate} />
              ) : (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: 300, p: 4 }}>
                  <Alert severity="info">
                    {debouncedJson === '{}' || debouncedJson === '{"sections":[]}'
                      ? 'Agregá secciones al template para ver la vista previa.'
                      : 'Template inválido: debe contener un array "sections".'}
                  </Alert>
                </Box>
              )}
            </Box>
          </Paper>

          {/* Branding upload */}
          {!isNew && (
            <Accordion
              variant="outlined"
              defaultExpanded={!!brandingLogoUrl}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle2" fontWeight={600}>
                  Branding / Logo
                </Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0 }}>
                <BrandingUpload
                  templateCode={template.code}
                  currentLogoUrl={brandingLogoUrl}
                  onLogoUpdate={handleLogoUpdate}
                />
              </AccordionDetails>
            </Accordion>
          )}
        </Box>
      </Box>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
