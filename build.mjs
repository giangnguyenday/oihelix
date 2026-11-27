import { cp, mkdir, rm } from 'node:fs/promises';

await rm(new URL('./dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
for (const name of ['index.html', 'styles.css', 'app.js', 'geometry.js', 'vendor', 'assets']) {
  await cp(new URL(name, import.meta.url), new URL(`dist/${name}`, import.meta.url), { recursive: true });
}
console.log('Built the static studio in dist/.');
