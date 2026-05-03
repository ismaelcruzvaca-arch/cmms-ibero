import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from './lib/supabaseClient'
import {
  Box,
  Typography,
  Paper,
  IconButton,
  Chip,
  CircularProgress,
  Alert,
} from '@mui/material'
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView'
import { TreeItem } from '@mui/x-tree-view/TreeItem'
import FolderIcon from '@mui/icons-material/Folder'
import BuildIcon from '@mui/icons-material/Build'

// Colores para criticidad según estándar industrial
const criticalityColors = {
  A: { bgColor: 'error.light', color: 'error.dark' },
  B: { bgColor: 'warning.light', color: 'warning.dark' },
  C: { bgColor: 'success.light', color: 'success.dark' },
}

/**
 * DEPRECATED — Reemplazado por src/components/AssetTree.jsx (RxDB offline-first).
 * App unificada el 2026-05-03. Este archivo se puede eliminar si no hay referencias.
 *
 * Componente AssetTree - Visualización jerárquica de activos
 * 
 * Construye el árbol en memoria haciendo join cliente-side entre
 * las tablas 'assets' y 'asset_hierarchy' de Supabase.
 */
export default function AssetTree() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [treeData, setTreeData] = useState([])

  const fetchData = async () => {
    setLoading(true)
    setError(null)

    try {
      // Fetch paralelo a ambas tablas
      const [assetsRes, hierarchyRes] = await Promise.all([
        supabase.from('assets').select('*'),
        supabase.from('asset_hierarchy').select('*'),
      ])

      if (assetsRes.error) {
        throw new Error(`Error en assets: ${assetsRes.error.message}`)
      }
      if (hierarchyRes.error) {
        throw new Error(`Error en asset_hierarchy: ${hierarchyRes.error.message}`)
      }

      const assets = assetsRes.data || []
      const hierarchy = hierarchyRes.data || []

      // Construir Map de assets para lookup O(1)
      const assetsMap = new Map()
      assets.forEach(asset => {
        assetsMap.set(asset.id, asset)
      })

      // Construir estructura de hijos: parentId -> childIds[]
      const childrenMap = new Map()
      hierarchy.forEach(rel => {
        const parentId = rel.parent_id
        const childId = rel.child_id

        if (!childrenMap.has(parentId)) {
          childrenMap.set(parentId, [])
        }
        childrenMap.get(parentId).push(childId)
      })

      // Identificar nodos raíz (activos que no son hijos de nadie)
      const childIds = new Set(hierarchy.map(rel => rel.child_id))
      const rootIds = assets
        .filter(asset => !childIds.has(asset.id))
        .map(asset => asset.id)

      // Construir árbol recursivamente
      const buildTree = (assetId) => {
        const asset = assetsMap.get(assetId)
        if (!asset) return null

        const childIds = childrenMap.get(assetId) || []
        const children = childIds
          .map(childId => buildTree(childId))
          .filter(Boolean)

        return {
          ...asset,
          children,
          hasChildren: children.length > 0,
        }
      }

      const tree = rootIds
        .map(rootId => buildTree(rootId))
        .filter(Boolean)

      setTreeData(tree)
    } catch (err) {
      console.error('Error fetchAssetTree:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  // Renderizar un nodo del árbol
  const renderTreeNode = (node) => {
    const icon = node.hasChildren ? <FolderIcon /> : <BuildIcon />
    const label = `${node.equipment_id} — ${node.description}`
    const crit = node.criticality?.toUpperCase() || 'C'
    const chipColors = criticalityColors[crit] || criticalityColors.C

    return (
      <TreeItem
        key={node.id}
        itemId={String(node.id)}
        label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
            {icon}
            <Typography variant="body2" sx={{ fontWeight: node.hasChildren ? 600 : 400 }}>
              {label}
            </Typography>
            <Chip
              label={crit}
              size="small"
              sx={{
                height: 20,
                fontSize: '0.7rem',
                fontWeight: 'bold',
                bgcolor: chipColors.bgColor,
                color: chipColors.color,
              }}
            />
          </Box>
        }
      >
        {node.children?.map(child => renderTreeNode(child))}
      </TreeItem>
    )
  }

  return (
    <Paper sx={{ p: 2, m: 2 }}>
      {/* Barra superior con título y botón de refresh */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h5" component="h2">
          Jerarquía de Activos
        </Typography>
<IconButton
          color="primary"
          aria-label="Actualizar árbol de activos"
        >
          ↻
        </IconButton>
      </Box>

      {/* Estados de loading y error */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Árbol de activos */}
      {!loading && !error && (
        <SimpleTreeView
          sx={{
            minHeight: 200,
            flexGrow: 1,
            maxWidth: '100%',
            '& .MuiTreeItem-content': {
              py: 0.5,
            },
          }}
        >
          {treeData.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              No hay activos registrados.
            </Typography>
          ) : (
            treeData.map(node => renderTreeNode(node))
          )}
        </SimpleTreeView>
      )}
    </Paper>
  )
}