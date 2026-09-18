import { cpSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../dist/db/migrations/',import.meta.url),{recursive:true});
cpSync(new URL('../src/db/migrations/',import.meta.url),new URL('../dist/db/migrations/',import.meta.url),{recursive:true});
