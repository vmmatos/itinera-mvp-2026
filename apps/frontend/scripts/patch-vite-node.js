#!/usr/bin/env node
/**
 * Patches @nuxt/vite-builder/dist/vite-node.mjs to read NUXT_VITE_NODE_OPTIONS
 * lazily on each connectSocket() call instead of caching it at module import time.
 *
 * Required because in Docker, Nitro imports vite-node.mjs before Nuxt's
 * configureServer hook sets the env var, causing socketPath to be undefined.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@nuxt',
  'vite-builder',
  'dist',
  'vite-node.mjs'
);

if (!fs.existsSync(filePath)) {
  console.log('[patch-vite-node] File not found, skipping patch.');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

if (content.includes('/* patched-lazy-socket-path */')) {
  console.log('[patch-vite-node] Already patched, skipping.');
  process.exit(0);
}

// Inject lazy re-read of env var at the top of connectSocket().
// Replaces the immediate rejection when socketPath is missing with a
// retry loop (up to 30s) so that Vite's configureServer hook has time
// to set NUXT_VITE_NODE_OPTIONS after Nitro has already started.
const original = 'function connectSocket() {\n\tif (clientSocket && !clientSocket.destroyed) return Promise.resolve(clientSocket);\n\tif (currentConnectPromise) return currentConnectPromise;';
const patched = `function connectSocket() { /* patched-lazy-socket-path */
\tif (clientSocket && !clientSocket.destroyed) return Promise.resolve(clientSocket);
\tif (currentConnectPromise) return currentConnectPromise;
\t// Re-read env var in case it was set after module import (Docker timing fix)
\tif (!viteNodeOptions.socketPath) {
\t\tObject.assign(viteNodeOptions, getViteNodeOptionsEnvVar());
\t}
\tif (!viteNodeOptions.socketPath) {
\t\t// Retry for up to 30s to allow Nuxt's Vite server to set the env var
\t\tcurrentConnectPromise = new Promise((resolve, reject) => {
\t\t\tlet attempts = 0;
\t\t\tconst poll = () => {
\t\t\t\tObject.assign(viteNodeOptions, getViteNodeOptionsEnvVar());
\t\t\t\tif (viteNodeOptions.socketPath) {
\t\t\t\t\tcurrentConnectPromise = null;
\t\t\t\t\tconnectSocket().then(resolve, reject);
\t\t\t\t} else if (attempts++ < 60) {
\t\t\t\t\tsetTimeout(poll, 500);
\t\t\t\t} else {
\t\t\t\t\tcurrentConnectPromise = null;
\t\t\t\t\treject(new Error('Vite Node IPC socket path not configured after 30s timeout.'));
\t\t\t\t}
\t\t\t};
\t\t\tpoll();
\t\t});
\t\treturn currentConnectPromise;
\t}`;

if (!content.includes(original)) {
  console.error('[patch-vite-node] Could not find target string in vite-node.mjs — Nuxt version may have changed. Patch skipped.');
  process.exit(0);
}

content = content.replace(original, patched);
fs.writeFileSync(filePath, content, 'utf8');
console.log('[patch-vite-node] Successfully patched @nuxt/vite-builder/dist/vite-node.mjs');
