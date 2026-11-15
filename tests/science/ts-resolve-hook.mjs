/**
 * Node ESM resolver hook for the science tests.
 *
 * Node 24 can execute TypeScript via type stripping, but it still requires
 * explicit file extensions in relative ESM specifiers. The application source
 * uses extensionless relative imports (Vite/tsc resolve them normally), so the
 * tests register a synchronous `module.registerHooks` resolver that appends
 * `.ts` when an extensionless relative specifier exists as a TypeScript file.
 *
 * Usage (PowerShell, from the repo root):
 *   $hook = [uri]::new((Resolve-Path tests/science/ts-resolve-hook.mjs)).AbsoluteUri
 *   node --import $hook --test tests/science/dem-slope.test.mjs
 *
 * A bare Windows path is rejected by `--import` (ERR_UNSUPPORTED_ESM_URL_SCHEME,
 * "Received protocol 'c:'"), hence the file:// URL conversion.
 */

import { statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const TS_EXTENSIONS = ['.ts', '.mts', '.tsx'];

function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    if (isRelative && context.parentURL?.startsWith('file:') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const parentDirectory = dirname(fileURLToPath(context.parentURL));
      const candidate = resolvePath(parentDirectory, specifier);
      for (const extension of TS_EXTENSIONS) {
        if (isFile(candidate + extension)) {
          return nextResolve(specifier + extension, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
