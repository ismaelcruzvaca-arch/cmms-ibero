/**
 * AssetTree - Componente de árbol de jerarquía de activos
 * Usa MUI Tree View con construcción memoizada del árbol
 */
import React, { useState } from 'react';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import { Box, Typography, IconButton, Chip, CircularProgress, SvgIcon } from '@mui/material';
import { useAssets } from '../lib/rxdb';

function FolderIcon(props) {
  return (
    <SvgIcon {...props}>
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8z" />
    </SvgIcon>
  );
}

function BuildIcon(props) {
  return (
    <SvgIcon {...props}>
      <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z" />
    </SvgIcon>
  );
}

function RefreshIcon(props) {
  return (
    <SvgIcon {...props}>
      <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z" />
    </SvgIcon>
  );
}

// Colores para criticidad
const CRITICALITY_COLORS = {
  A: { bg: '#ff1744', color: 'white' },  // Rojo - Crítica
  B: { bg: '#ff9100', color: 'white' }, // Naranja - Media
  C: { bg: '#00e676', color: 'black' }  // Verde - Baja
};

const CRITICALITY_LABELS = {
  A: 'Alta',
  B: 'Media',
  C: 'Baja'
};

function AssetTreeNode({ node, level = 0, onSelectAsset }) {
  const hasChildren = node.children && node.children.length > 0;
  const criticalityStyle = CRITICALITY_COLORS[node.criticality] || CRITICALITY_COLORS.C;

  return (
    <TreeItem
      itemId={String(node.id)}
      label={
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}
          onClick={(e) => {
            if (!hasChildren) {
              e.stopPropagation();
              onSelectAsset && onSelectAsset(node);
            }
          }}
        >
          {hasChildren ? (
            <FolderIcon sx={{ color: '#1976d2', fontSize: 20 }} />
          ) : (
            <BuildIcon sx={{ color: '#757575', fontSize: 20 }} />
          )}
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {node.equipment_id}
          </Typography>
          {node.description && (
            <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
              {node.description}
            </Typography>
          )}
          {node.criticality && (
            <Chip
              label={CRITICALITY_LABELS[node.criticality] || node.criticality}
              size="small"
              sx={{
                backgroundColor: criticalityStyle.bg,
                color: criticalityStyle.color,
                fontSize: '0.7rem',
                height: 20,
                fontWeight: 'bold'
              }}
            />
          )}
          {node.location && (
            <Typography variant="caption" color="text.secondary">
              📍 {node.location}
            </Typography>
          )}
        </Box>
      }
    >
      {hasChildren && node.children.map(child => (
        <AssetTreeNode key={child.id} node={child} level={level + 1} onSelectAsset={onSelectAsset} />
      ))}
    </TreeItem>
  );
}

export default function AssetTree({ onSelectAsset }) {
  const { assetTree, loading, error, syncStatus, refreshAssets } = useAssets();
  const [expanded, setExpanded] = useState([]);

  const handleToggle = (event, nodeIds) => {
    setExpanded(nodeIds);
  };

  const handleRefresh = () => {
    console.log('[AssetTree] Refrescando datos...');
    refreshAssets();
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography color="error">Error al cargar activos: {error.message}</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header con botón de refresh */}
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        mb: 2,
        p: 1,
        backgroundColor: '#f5f5f5',
        borderRadius: 1
      }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Jerarquía de Activos
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Estado: {syncStatus}
          </Typography>
          <IconButton 
            onClick={handleRefresh} 
            size="small"
            title="Forzar sincronización"
            disabled={syncStatus === 'syncing'}
          >
            <RefreshIcon 
              sx={{ 
                animation: syncStatus === 'syncing' ? 'spin 1s linear infinite' : 'none',
                '@keyframes spin': {
                  '0%': { transform: 'rotate(0deg)' },
                  '100%': { transform: 'rotate(360deg)' }
                }
              }}
            />
          </IconButton>
        </Box>
      </Box>

      {/* Árbol */}
      <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
        {assetTree.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">
              No hay activos disponibles
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Los activos se sincronizarán desde Supabase
            </Typography>
          </Box>
        ) : (
          <SimpleTreeView
            expandedItems={expanded}
            onExpandedItemsChange={handleToggle}
            sx={{
              '& .MuiTreeItem-label': {
                fontSize: '0.875rem'
              }
            }}
          >
            {assetTree.map(node => (
              <AssetTreeNode key={node.id} node={node} onSelectAsset={onSelectAsset} />
            ))}
          </SimpleTreeView>
        )}
      </Box>

      {/* Leyenda */}
      <Box sx={{ 
        display: 'flex', 
        gap: 2, 
        pt: 2, 
        borderTop: '1px solid #e0e0e0',
        mt: 2
      }}>
        <Chip size="small" label="Alta" sx={{ backgroundColor: '#ff1744', color: 'white' }} />
        <Chip size="small" label="Media" sx={{ backgroundColor: '#ff9100', color: 'white' }} />
        <Chip size="small" label="Baja" sx={{ backgroundColor: '#00e676', color: 'black' }} />
      </Box>
    </Box>
  );
}