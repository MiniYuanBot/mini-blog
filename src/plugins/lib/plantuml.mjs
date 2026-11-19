// deterministic source hashing and a synchronous cache.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encode } from 'plantuml-encoder';

// Preserve the original notes' appearance and their reproducible offline cache.
export const commonStyle = `hide circle
skinparam classAttributeIconSize 0
skinparam shadowing false
skinparam class {
    BackgroundColor #FEFEFE
    BorderColor #333
    ArrowColor #666
    FontColor #333
    FontSize 14
    AttributeFontSize 12
    MethodFontSize 12
    RoundCorner 4
}`;
export function diagramSource(code) {
  const raw = code.trim();
  const openingLine = /^@startuml\b[^\r\n]*/m;
  return openingLine.test(raw)
    ? raw.replace(openingLine, (opening) => `${opening}\n${commonStyle}`)
    : `@startuml\n${commonStyle}\n${raw}\n@enduml`;
}
export const diagramHash = (source) => createHash('sha256').update(source).digest('hex').slice(0, 32);
export const cacheFile = (source, root = process.cwd()) => join(root, '.plantuml-cache', `${diagramHash(source)}.svg`);
export const remoteUrl = (source) => `${(process.env.PLANTUML_SERVER || 'https://www.plantuml.com/plantuml').replace(/\/$/, '')}/svg/${encode(source)}`;
export function cachedSvg(source, root) {
  const file = cacheFile(source, root);
  if (!existsSync(file)) return null;
  const svg = readFileSync(file, 'utf8');
  return /<svg[\s>]/.test(svg) ? svg : null;
}
