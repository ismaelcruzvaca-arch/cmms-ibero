/**
 * AssetTree - Componente de árbol de jerarquía de activos
 * Usa MUI Tree View con construcción memoizada del árbol
 */
import React, { useState } from 'react';
import { Box, Typography, IconButton, Chip, CircularProgress } from '@mui/material';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import FolderIcon from '@mui/icons-material/Folder';
import BuildIcon from '@mui/icons-material/Build';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useAssets } from '../lib/rxdb';

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

function AssetTreeNode({ node, level = 0, onAssetClick }) {
  const hasChildren = node.children && node.children.length > 0;
  const criticalityStyle = CRITICALITY_COLORS[node.criticality] || CRITICALITY_COLORS.C;

  const handleClick = (e) => {
    e.stopPropagation();
    if (onAssetClick) onAssetClick(node);
  };

  return (
    <TreeItem
      itemId={String(node.id)}
      label={
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, cursor: 'pointer' }}
          onClick={handleClick}
        >
          {hasChildren ? (
            <FolderIcon sx={{ color: '#1976d2', fontSize: 20 }} />
          ) : (
            <BuildIcon sx={{ color: '#757575', fontSize: 20 }} />
          )}
          <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid={`asset-label-${node.equipment_id}`}>
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
        <AssetTreeNode key={child.id} node={child} level={level + 1} onAssetClick={onAssetClick} />
      ))}
    </TreeItem>
  );
}

export default function AssetTree({ onAssetClick }) {
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
              <AssetTreeNode key={node.id} node={node} onAssetClick={onAssetClick} />
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