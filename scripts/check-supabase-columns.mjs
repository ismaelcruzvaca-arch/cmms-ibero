import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres:Churrumais1.@db.zbnritimnflkgihbfahb.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function check() {
  await client.connect();
  console.log('Conectado a Supabase Postgres\n');

  const tables = ['work_orders', 'assets', 'asset_hierarchy'];

  for (const table of tables) {
    const res = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
      [table]
    );

    console.log(`=== ${table} (${res.rows.length} columnas) ===`);

    const hasDeleted = res.rows.some(r => r.column_name === 'deleted');
    const hasIsDeleted = res.rows.some(r => r.column_name === 'is_deleted');

    res.rows.forEach(r => {
      const marker = (r.column_name === 'deleted' || r.column_name === 'is_deleted') ? '  <-- SOFT DELETE' : '';
      console.log(`  ${r.column_name.padEnd(25)} ${r.data_type}${marker}`);
    });

    if (hasDeleted && !hasIsDeleted) {
      console.log(`\n  >> ACCION REQUERIDA: columna "deleted" existe. Renombrar a "is_deleted".`);
      console.log(`     ALTER TABLE ${table} RENAME COLUMN deleted TO is_deleted;`);
    } else if (!hasDeleted && hasIsDeleted) {
      console.log(`\n  >> OK: columna "is_deleted" ya existe. Compatible con el fix.`);
    } else if (hasDeleted && hasIsDeleted) {
      console.log(`\n  >> ADVERTENCIA: AMBAS columnas existen. Hay que limpiar.`);
    } else {
      console.log(`\n  >> ADVERTENCIA: No se encontro columna soft-delete.`);
    }
    console.log('');
  }

  await client.end();
}

check().catch(e => {
  console.error('ERROR:', e.message);
  client.end().catch(() => {});
});
