/**
 * Exporta os contratos Zod como JSON Schema para o device-gateway (Python) validar
 * exatamente o mesmo formato. Rode após mudar qualquer schema em src/.
 *
 *   pnpm --filter @netx-nms/shared export:schema
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { DeviceJobSchema, DeviceJobResultSchema } from '../src/jobs.js';
import { DeviceEventSchema, JobProgressSchema } from '../src/events.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../../apps/device-gateway/contracts');
mkdirSync(outDir, { recursive: true });

const bundle = {
  DeviceJob: zodToJsonSchema(DeviceJobSchema, 'DeviceJob'),
  DeviceJobResult: zodToJsonSchema(DeviceJobResultSchema, 'DeviceJobResult'),
  DeviceEvent: zodToJsonSchema(DeviceEventSchema, 'DeviceEvent'),
  JobProgress: zodToJsonSchema(JobProgressSchema, 'JobProgress'),
};

for (const [name, schema] of Object.entries(bundle)) {
  const file = resolve(outDir, `${name}.schema.json`);
  writeFileSync(file, JSON.stringify(schema, null, 2) + '\n');
  console.log(`escrito ${file}`);
}
