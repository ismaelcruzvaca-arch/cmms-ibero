import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres:Churrumais1.@db.zbnritimnflkgihbfahb.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  await client.connect();
  console.log('Conectado. Ejecutando migraciones...\n');

  const renames = [
    'ALTER TABLE work_orders RENAME COLUMN deleted TO is_deleted;',
    'ALTER TABLE assets RENAME COLUMN deleted TO is_deleted;',
    'ALTER TABLE asset_hierarchy RENAME COLUMN deleted TO is_deleted;'
  ];

  for (const sql of renames) {
    try {
      await client.query(sql);
      console.log('OK: ' + sql);
    } catch (err) {
      console.error('FAIL: ' + sql);
      console.error('  ' + err.message);
    }
  }

  console.log('\nVerificacion post-migracion:');
  const tables = ['work_orders', 'assets', 'asset_hierarchy'];
  for (const table of tables) {
    const res = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name IN ('deleted', 'is_deleted')`,
      [table]
    );
    const cols = res.rows.map(r => r.column_name);
    console.log('  ' + table + ': ' + cols.join(', '));
  }

  await client.end();
  console.log('\nMigracion completada.');
}

migrate().catch(e => {
  console.error('ERROR:', e.message);
  client.end().catch(() => {});
});
