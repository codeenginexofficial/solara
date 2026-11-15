/**
 * Node ESM hooks for Worker integration tests. Node 24 strips the Worker's
 * TypeScript types; this hook resolves extensionless TS imports and loads the
 * Worker's Wrangler text-module Markdown import as a string.
 */

import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.md') && context.parentURL?.startsWith('file:')) {
      return {
        url: new URL(specifier, context.parentURL).href,
        format: 'module',
        shortCircuit: true,
      };
    }

    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    if (isRelative && context.parentURL?.startsWith('file:') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const candidate = `${resolvePath(dirname(fileURLToPath(context.parentURL)), specifier)}.ts`;
      try {
        const source = readFileSync(candidate);
        if (source.length > 0) return nextResolve(`${specifier}.ts`, context);
      } catch {
        // Let Node report the usual resolution error if no TS module exists.
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.md')) {
      const markdown = readFileSync(fileURLToPath(url), 'utf8');
      return {
        format: 'module',
        source: `export default ${JSON.stringify(markdown)};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
