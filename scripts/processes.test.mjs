import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { ProcessSupervisor, waitForHttp } from './processes.mjs';

function child(pid) {
  const result = new EventEmitter();
  result.pid = pid;
  result.killed = false;
  return result;
}

const quiet = () => {};

test('spawn errors shut down an already running sibling and return failure', async () => {
  const sibling = child(100);
  const failed = child(undefined);
  const signals = [];
  let count = 0;
  const supervisor = new ProcessSupervisor({
    platform: 'linux', graceMs: 20, log: quiet, groupExists: () => false,
    spawnProcess: () => (++count === 1 ? sibling : failed),
    killGroup: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === 'SIGTERM') queueMicrotask(() => sibling.emit('close', 0, null));
    },
  });
  supervisor.start('node', ['server']);
  supervisor.start('missing-command', []);
  failed.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' }));
  failed.emit('close', -2, null);
  assert.equal(await supervisor.done, 1);
  assert.deepEqual(signals, [[-100, 'SIGTERM']]);
});

test('synchronous spawn failures are handled without starting more children', async () => {
  const supervisor = new ProcessSupervisor({
    spawnProcess: () => { throw new Error('spawn failure'); }, log: quiet, groupExists: () => false, graceMs: 20,
  });
  assert.equal(supervisor.start('missing', []), null);
  assert.throws(() => supervisor.start('other', []), /shutting down/);
  assert.equal(await supervisor.done, 1);
});

test('POSIX cleanup escalates when SIGTERM was sent but the process did not exit', async () => {
  const stubborn = child(200);
  const signals = [];
  const supervisor = new ProcessSupervisor({
    platform: 'linux', graceMs: 20, log: quiet, groupExists: () => false, spawnProcess: () => stubborn,
    killGroup: (pid, signal) => {
      signals.push([pid, signal]);
      stubborn.killed = true; // A sent signal is not proof of exit.
      if (signal === 'SIGKILL') queueMicrotask(() => stubborn.emit('close', null, 'SIGKILL'));
    },
  });
  supervisor.start('node', []);
  const stopping = supervisor.stop(0);
  assert.equal(supervisor.stop(1), stopping);
  assert.equal(await stopping, 0);
  assert.deepEqual(signals, [[-200, 'SIGTERM'], [-200, 'SIGKILL']]);
  assert.equal(supervisor.children[0].closed, true);
});

test('POSIX descendants retain the grace period after their watcher closes', async () => {
  const watcher = child(250);
  let descendantsAlive = true;
  let forcedAt;
  const supervisor = new ProcessSupervisor({
    platform: 'linux', graceMs: 30, log: quiet,
    spawnProcess: () => watcher, groupExists: () => descendantsAlive,
    killGroup: (_pid, signal) => {
      if (signal === 'SIGTERM') queueMicrotask(() => watcher.emit('close', 0, null));
      if (signal === 'SIGKILL') { descendantsAlive = false; forcedAt = Date.now(); }
    },
  });
  supervisor.start('node', ['watch']);
  const startedAt = Date.now();
  await supervisor.stop(0);
  assert(forcedAt - startedAt >= 25, 'descendants must not be force-killed immediately after watcher close');
  assert.equal(descendantsAlive, false);
});

test('Windows cleanup uses taskkill for the complete process tree and escalates', async () => {
  const stubborn = child(300);
  const calls = [];
  const supervisor = new ProcessSupervisor({
    platform: 'win32', graceMs: 20, log: quiet, groupExists: () => false,
    spawnProcess: (command, args, options) => {
      calls.push({ command, args, options });
      if (command !== 'taskkill') return stubborn;
      const killer = child(301);
      queueMicrotask(() => {
        killer.emit('close', args.includes('/F') ? 0 : 1, null);
        if (args.includes('/F')) stubborn.emit('close', null, 'SIGTERM');
      });
      return killer;
    },
  });
  supervisor.start('node', ['watch']);
  await supervisor.stop(0);
  assert.equal(calls[0].options.detached, false);
  assert.deepEqual(calls.slice(1).map(({ args }) => args), [
    ['/PID', '300', '/T'], ['/PID', '300', '/T', '/F'],
  ]);
  assert.equal(supervisor.children[0].closed, true);
});

test('failed Windows taskkill reports nonzero when the child never closes', async () => {
  const lingering = child(350);
  const commands = [];
  const messages = [];
  const supervisor = new ProcessSupervisor({
    platform: 'win32', graceMs: 5, log: (message) => messages.push(message),
    spawnProcess: (command, args) => {
      if (command !== 'taskkill') return lingering;
      commands.push(args);
      const killer = child(351);
      queueMicrotask(() => killer.emit('close', 1, null));
      return killer;
    },
  });
  supervisor.start('node', []);
  assert.equal(await supervisor.stop(0), 1);
  assert.equal(await supervisor.done, 1);
  assert.equal(supervisor.children[0].closed, false);
  assert.deepEqual(commands, [['/PID', '350', '/T'], ['/PID', '350', '/T', '/F']]);
  assert(messages.some((message) => message.includes('cleanup incomplete') && message.includes('350')));
});

test('a child closing unexpectedly with code zero still fails the partial stack', async () => {
  const completed = child(400);
  const supervisor = new ProcessSupervisor({
    platform: 'linux', graceMs: 20, log: quiet, groupExists: () => false, spawnProcess: () => completed,
    killGroup: () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); },
  });
  supervisor.start('node', []);
  completed.emit('close', 0, null);
  assert.equal(await supervisor.done, 1);
});

test('HTTP readiness waits for an actual expected response, not a fixed startup delay', async (t) => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts += 1;
    return new Response(attempts === 1 ? 'starting' : 'ready');
  });
  await waitForHttp('http://127.0.0.1:1234/', {
    timeoutMs: 1000, expected: async (response) => (await response.text()) === 'ready',
  });
  assert.equal(attempts, 2);
});

test('HTTP readiness is cancelled when the supervisor shuts down', async () => {
  const controller = new AbortController();
  controller.abort(new Error('shutdown'));
  await assert.rejects(waitForHttp('http://127.0.0.1:1234/', { signal: controller.signal }), /shutdown/);
});
