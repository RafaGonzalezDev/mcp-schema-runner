#!/usr/bin/env node
/**
 * dev.mjs — single-command launcher for mcp-schema-runner
 *
 * Starts the local API server (port 3001) and the Vite frontend (port 5173)
 * simultaneously, prefixes each line with a color tag, and prints a
 * clickable hyperlink (ANSI OSC 8) to the frontend once Vite is ready.
 *
 * Why a custom orchestrator instead of `concurrently`?
 *   - We want a reliable way to print a clickable URL once Vite is listening.
 *     We listen to the child's stdout and react to Vite's "Local:" line,
 *     then re-emit a styled line with an OSC 8 hyperlink so the link is
 *     always visible regardless of terminal width or Vite build flags.
 *   - If either child crashes we tear down the other and exit non-zero,
 *     so a half-running stack never lingers.
 *
 * Why spawn node/vite directly instead of `npm run dev`?
 *   - On systems with nvm, npm 11+ silently "promotes" to the newest
 *     installed Node when running scripts, which can cause native modules
 *     to be loaded by a different Node version. Running the entry point
 *     directly under the same node as the orchestrator avoids that
 *     mismatch entirely.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// --- ANSI helpers ------------------------------------------------------------

const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;

const fg = (r, g, b) => `${ESC}[38;2;${r};${g};${b}m`;
const SERVER = fg(126, 231, 135); // green-ish for server
const CLIENT = fg(120, 200, 255); // cool blue for client
const ACCENT = fg(197, 224, 99); // #c5e063 design-system lime
const MUTED = fg(155, 151, 140); // #9b978c muted

// OSC 8 hyperlink. Terminals without support just render the visible text.
const link = (url, label) =>
  `${ESC}]8;;${url}${ESC}\\${ACCENT}${BOLD}${label}${RESET}${ESC}]8;;${ESC}\\`;

const tag = (name, color) => `${color}${BOLD}[${name.padEnd(7)}]${RESET} `;

// --- Pre-flight --------------------------------------------------------------

function ensureDeps() {
  const missing = [];
  for (const sub of ['server', 'client']) {
    if (!existsSync(resolve(root, sub, 'node_modules'))) missing.push(sub);
  }
  if (missing.length > 0) {
    console.error(
      `${MUTED}missing dependencies in: ${missing.join(', ')}. run \`npm run install:all\` first.${RESET}`,
    );
    process.exit(1);
  }
}

ensureDeps();

// --- Process management ------------------------------------------------------

const procs = [];
let shuttingDown = false;

function spawnChild(name, color, cwd, command, args) {
  const child = spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  procs.push({ name, color, child });

  const prefix = tag(name, color);
  const relay = (stream, isErr) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        process.stdout.write(`${prefix}${line}\n`);
      }
    });
    stream.on('end', () => {
      if (buffer.length > 0) {
        process.stdout.write(`${prefix}${buffer}\n`);
        buffer = '';
      }
    });
  };
  relay(child.stdout, false);
  relay(child.stderr, true);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    process.stdout.write(
      `${prefix}${DIM}exited (code=${code ?? 'null'} signal=${signal ?? 'null'})${RESET}\n`,
    );
    shutdown(code ?? 1);
  });

  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of procs) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => {
    for (const { child } of procs) {
      if (!child.killed) child.kill('SIGKILL');
    }
    process.exit(code);
  }, 800);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// --- Boot --------------------------------------------------------------------

const banner = [
  `${ACCENT}${BOLD}mcp-schema-runner${RESET} ${MUTED}· local MCP dev tool${RESET}`,
  `${MUTED}starting api server (3001) and web client (5173)...${RESET}`,
];
console.log(banner.join('\n'));

// Server first so the API is up when the client starts proxying.
const tsxBin = resolve(root, 'server/node_modules/.bin/tsx');
spawnChild('server', SERVER, resolve(root, 'server'), tsxBin, [
  'watch',
  'src/index.ts',
]);

spawnChild('client', CLIENT, resolve(root, 'client'), 'node', [
  resolve(root, 'client/node_modules/vite/bin/vite.js'),
  '--port',
  '5173',
  '--strictPort',
]);

// Print a clickable URL hint once the client is likely ready.
setTimeout(() => {
  const url = 'http://localhost:5173';
  console.log(`${MUTED}frontend ready at ${link(url, url)}${RESET}`);
}, 1500);
