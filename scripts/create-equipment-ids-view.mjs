import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres:Churrumais1.@db.zbnritimnflkgihbfahb.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Conectado a Supabase Postgres\n');

  const sql = `
    CREATE OR REPLACE VIEW equipment_ids AS 
    SELECT equipment_id FROM assets WHERE is_deleted = false;
  `;

  try {
    await client.query(sql);
    console.log('OK: Vista equipment_ids creada exitosamente.\n');
  } catch (err) {
    console.error('FAIL:', err.message);
    await client.end();
    process.exit(1);
  }

  // Verificar
  const { rows } = await client.query(`SELECT * FROM equipment_ids LIMIT 10`);
  console.log(`Verificación: ${rows.length} equipment_ids encontrados`);
  rows.forEach(r => console.log(`  ${r.equipment_id}`));

  await client.end();
  console.log('\nDone.');
}

run().catch(e => {
  console.error('FATAL:', e.message);
  client.end().catch(() => {});
});
