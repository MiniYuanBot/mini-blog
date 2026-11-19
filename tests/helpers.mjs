import { readFile } from 'node:fs/promises';
import ts from 'typescript';

/** The helpers under test have no runtime imports. Compile them in memory so
 * tests work on Node 22.12 as well as versions with native type stripping. */
export async function importTypeScript(url) {
  const source = await readFile(url, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: url.pathname,
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
