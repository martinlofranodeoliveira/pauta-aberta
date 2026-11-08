import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNotebook, serializeNotebook } from '../assets/domain.mjs';
import { minutesMarkdown, actionsCsv } from '../assets/formats.mjs';
import { createExampleNotebook } from '../assets/example.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const checked = [];
async function inspect(directory) {
  for (const name of await readdir(directory)) {
    if (['.git', 'node_modules', '.impeccable'].includes(name)) continue;
    const location = path.join(directory, name), entry = await lstat(location);
    if (entry.isSymbolicLink()) throw Error('Links simbólicos não fazem parte desta distribuição.');
    if (entry.isDirectory()) { await inspect(location); continue; }
    if (/^\.env|\.(?:pem|key|sqlite|db)$/.test(name)) throw Error('Arquivo operacional encontrado no material de publicação.');
    if (!/\.(?:html|mjs|js|css|json|md|yml|svg)$/.test(name)) continue;
    const text = await readFile(location, 'utf8');
    if (/(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|(?:appgprj_|appgdep_)[a-z0-9]{15,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) throw Error('Possível credencial em ' + path.relative(root, location));
    checked.push(path.relative(root, location));
  }
}
await inspect(root);
for (const name of ['LICENSE.txt', 'THIRD_PARTY_NOTICES.md', 'assets/LATO-LICENSE.txt']) {
  if (!(await readFile(path.join(root, 'dist', name), 'utf8')).trim()) throw Error('Aviso de licença ausente na distribuição.');
}
const html = await readFile(path.join(root, 'dist/index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
  const url = match[1]; if (/^https?:/.test(url)) continue;
  const local = url.split(/[?#]/)[0]; if (!local || local === './') continue;
  await lstat(path.join(root, 'dist', local));
}
if (!html.includes("connect-src 'none'") || !html.includes('lang="pt-BR"')) throw Error('Política de conteúdo ou idioma ausente.');
const example = createExampleNotebook();
const json = await readFile(path.join(root, 'examples/caderno-exemplo.json'), 'utf8');
if (serializeNotebook(parseNotebook(json)) !== serializeNotebook(example) || json !== serializeNotebook(example)) throw Error('Exemplo JSON diverge do gerador.');
if (await readFile(path.join(root, 'examples/ata-versao-1.md'), 'utf8') !== minutesMarkdown(example.meetings[0], 1)) throw Error('Markdown de exemplo diverge.');
if (await readFile(path.join(root, 'examples/encaminhamentos.csv'), 'utf8') !== actionsCsv(example, '2026-11-08')) throw Error('CSV de exemplo diverge.');
console.log(JSON.stringify({ status: 'pass', textFiles: checked.length, canonicalExample: true, staticConnectPolicy: 'none', runtimeDependencies: 0 }));
