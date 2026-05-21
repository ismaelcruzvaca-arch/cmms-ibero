/**
 * Pre-build check - Detecta errores críticos antes del build
 * Ejecutar: npm run prebuild
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const criticalFiles = [
  'src/lib/rxdb.js',
  'src/hooks/useWorkOrders.js',
  'src/lib/supabaseClient.js',
  'src/App.jsx'
];

const errors = [];

console.log('🔍 Pre-build Check...\n');

for (const file of criticalFiles) {
  const filePath = join(rootDir, file);
  console.log(`  Checking: ${file}`);
  
  if (!existsSync(filePath)) {
    errors.push(`❌ Archivo no encontrado: ${file}`);
    continue;
  }
  
  try {
    const content = readFileSync(filePath, 'utf-8');
    
    // Verificar que los imports principales existen
    if (file === 'src/lib/rxdb.js') {
      if (!content.includes('createRxDatabase')) {
        errors.push(`❌ ${file}: Falta import de createRxDatabase`);
      }
      if (!content.includes('work_orders')) {
        errors.push(`❌ ${file}: Falta referencia a work_orders`);
      }
    }
    
    if (file === 'src/hooks/useWorkOrders.js') {
      if (!content.includes('initRxDB')) {
        errors.push(`❌ ${file}: Falta import de initRxDB`);
      }
    }
    
  } catch (err) {
    errors.push(`❌ Error leyendo ${file}: ${err.message}`);
  }
}

console.log('');

if (errors.length > 0) {
  console.log('❌ PRE-BUILD FAILED:\n');
  errors.forEach(e => console.log(e));
  console.log('\n📝 Arregla los errores antes de hacer build.');
  process.exit(1);
}

console.log('✅ Pre-build check Passed!');
console.log('   - Archivos críticos verificados');
console.log('   - Imports y referencias validados\n');