import React, { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import { Container, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper } from '@mui/material'

function App() {
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAssets()
  }, [])

  const fetchAssets = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('assets')
      .select('*')
    if (error) console.error(error)
    else setAssets(data)
    setLoading(false)
  }

  return (
    <Container maxWidth="lg">
      <Typography variant="h4" sx={{ my: 4 }}>
        Inventario de Activos
      </Typography>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Equipo ID</TableCell>
              <TableCell>Descripcion</TableCell>
              <TableCell>Ubicacion</TableCell>
              <TableCell>Criticidad</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5}>Cargando...</TableCell></TableRow>
            ) : assets.map(asset => (
              <TableRow key={asset.id}>
                <TableCell>{asset.id}</TableCell>
                <TableCell>{asset.equipment_id}</TableCell>
                <TableCell>{asset.description}</TableCell>
                <TableCell>{asset.location}</TableCell>
                <TableCell>{asset.criticality}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Container>
  )
}

export default App