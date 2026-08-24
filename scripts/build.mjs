import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'public');
const output = resolve(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
const info = await stat(resolve(output, 'index.html'));
if (!info.isFile()) throw new Error('Build failed: dist/index.html was not created.');
console.log('Built static application into dist/.');
