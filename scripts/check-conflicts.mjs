import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const directories = new Set(['app', 'components', 'lib', 'api', 'scripts', 'tests']);
const conflicts = [];
function scan(directory) {
  for (const entry of readdirSync(directory, {withFileTypes:true})) {
    const path = join(directory,entry.name);
    if (entry.isDirectory()) {
      if (directory !== root || directories.has(entry.name)) scan(path);
    } else if (/\.(?:[cm]?[jt]sx?|css|json)$/.test(entry.name)) {
      const lines = readFileSync(path,'utf8').split(/\r?\n/);
      lines.forEach((line,i) => {
        if (/^(?:<{7}(?: |$)|={7}$|>{7}(?: |$)|\|{7}(?: |$))/.test(line)) conflicts.push(`${relative(root,path)}:${i+1}`);
      });
    }
  }
}
scan(root);
if (conflicts.length) throw new Error(`Unresolved merge conflicts. Resolve these before testing or deploying:\n${conflicts.join('\n')}`);
