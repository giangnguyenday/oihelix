import { readFile, writeFile } from 'node:fs/promises';

const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const moduleURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const replaceThree = source => source.replaceAll("'./vendor/three.module.js'", "'three'").replaceAll("'./three.module.js'", "'three'");
const imports = {
  'three/core': moduleURL(await read('vendor/three.core.js')),
  'three': moduleURL((await read('vendor/three.module.js')).replaceAll("'./three.core.js'", "'three/core'")),
  'three/addons/controls/OrbitControls.js': moduleURL(replaceThree(await read('vendor/OrbitControls.js'))),
  'three/addons/environments/RoomEnvironment.js': moduleURL(replaceThree(await read('vendor/RoomEnvironment.js'))),
  'ribbon/original': moduleURL(replaceThree(await read('geometry.js'))),
  'ribbon/evolution': moduleURL(replaceThree(await read('spatial-evolution-geometry.js')).replaceAll("'./geometry.js'", "'ribbon/original'")),
};
const imageURL = async name => 'data:image/png;base64,' + (await readFile(new URL(name, import.meta.url))).toString('base64');
const replacements = {
  '__EVOLUTION_CSS__': await read('evolution.css'),
  '__EVOLUTION_IMPORT_MAP__': JSON.stringify({ imports }),
  '__EVOLUTION_RUNTIME__': (await read('evolution.js')).replaceAll('</script', '<\\/script'),
  '__ORIGINAL_LOGO_DATA__': await imageURL('assets/logo.png'),
  '__SKETCH_DATA__': await imageURL('assets/helix-sketch.png'),
  '__FUNNEL_REFERENCE_DATA__': await imageURL('assets/funnel-reference.png'),
  '__CONSTRUCTION_REFERENCE_DATA__': await imageURL('assets/spiral-construction.png'),
};
let html = await read('evolution.template.html');
for (const [key, value] of Object.entries(replacements)) html = html.replaceAll(key, value);
await writeFile(new URL('evolution.html', import.meta.url), html);
console.log(`Built standalone 3D evolution HTML (${Buffer.byteLength(html).toLocaleString()} bytes).`);
