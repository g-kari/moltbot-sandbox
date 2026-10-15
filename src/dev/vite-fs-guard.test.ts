import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createServer, isFileServingAllowed, normalizePath, type ViteDevServer } from 'vite';

// GHSA-rq7h-c2jc-7f22 applies to non-Windows dev-server paths.
// Both the outside marker and the matching in-root decoy are our own tiny fixtures.
it.skipIf(process.platform === 'win32')('keeps a same-URL outside fixture denied after import analysis', async () => {
  const outsideDirectory = await mkdtemp(join(tmpdir(), 'vite-outside-'));
  let root: string | undefined;
  let server: ViteDevServer | undefined;
  try {
    root = await mkdtemp(join(tmpdir(), 'vite-root-'));
    const outsideFile = join(outsideDirectory, 'guard-marker.txt');
    const relativeMirror = normalizePath(outsideFile).replace(/^\/+/, '');
    const decoyFile = join(root, relativeMirror);
    await mkdir(join(decoyFile, '..'), { recursive: true });
    await writeFile(outsideFile, 'SYNTHETIC_OUTSIDE_GUARD_MARKER\n');
    await writeFile(decoyFile, 'SYNTHETIC_PROJECT_DECOY\n');
    const moduleFile = join(root, 'main.js');
    const importPath = `./${normalizePath(relative(root, decoyFile))}?raw`;
    await writeFile(moduleFile, `import ${JSON.stringify(importPath)};\n`);
    server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
        watch: null,
        fs: { strict: true, allow: [root] },
      },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    expect(isFileServingAllowed(outsideFile, server)).toBe(false);
    expect(isFileServingAllowed(moduleFile, server)).toBe(true);
    const transformed = await server.transformRequest('/main.js');
    expect(transformed?.code).toContain('guard-marker.txt');
    expect(isFileServingAllowed(outsideFile, server)).toBe(false);
    expect(isFileServingAllowed(decoyFile, server)).toBe(true);
    expect(await readFile(outsideFile, 'utf8')).toBe('SYNTHETIC_OUTSIDE_GUARD_MARKER\n');
  } finally {
    try {
      await server?.close();
    } finally {
      try {
        if (root) await rm(root, { recursive: true, force: true });
      } finally {
        await rm(outsideDirectory, { recursive: true, force: true });
      }
    }
  }
});
