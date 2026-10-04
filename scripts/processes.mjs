import { spawn } from 'node:child_process';

/** Supervise independent process trees without relying on child.killed. */
export class ProcessSupervisor {
  constructor({ spawnProcess = spawn, platform = process.platform, graceMs = 8000,
    killGroup = process.kill.bind(process), groupExists, log = console.error } = {}) {
    this.spawnProcess = spawnProcess;
    this.platform = platform;
    this.graceMs = graceMs;
    this.killGroup = killGroup;
    this.groupExists = groupExists ?? ((pid) => {
      try { process.kill(-pid, 0); return true; }
      catch (error) { if (error.code === 'ESRCH') return false; throw error; }
    });
    this.log = log;
    this.children = [];
    this.stopping = false;
    this.abortController = new AbortController();
    this.done = new Promise((resolve) => { this.resolveDone = resolve; });
  }

  start(command, args, options = {}) {
    if (this.stopping) throw new Error('supervisor is shutting down');
    const record = { child: null, closed: false, error: null };
    record.closedPromise = new Promise((resolve) => { record.resolveClosed = resolve; });
    this.children.push(record);
    try {
      record.child = this.spawnProcess(command, args, {
        stdio: 'inherit', detached: this.platform !== 'win32', ...options,
      });
    } catch (error) {
      record.error = error;
      record.closed = true;
      record.resolveClosed();
      this.log(`failed to spawn ${command}: ${error.message}`);
      void this.stop(1);
      return null;
    }
    record.child.once('error', (error) => {
      record.error = error;
      if (!record.child.pid) {
        record.closed = true;
        record.resolveClosed();
      }
      this.log(`failed to spawn ${command}: ${error.message}`);
      void this.stop(1);
    });
    record.child.once('close', (code, signal) => {
      record.closed = true;
      record.resolveClosed();
      if (!this.stopping) {
        this.log(`child exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
        // Even a successful early exit leaves an incomplete development stack.
        void this.stop(code || 1);
      }
    });
    return record.child;
  }

  async terminateTree(record, force) {
    const pid = record.child?.pid;
    if (!pid) return;
    if (this.platform === 'win32') {
      // taskkill targets descendants as well as the watch-process root.
      await new Promise((resolve) => {
        let killer;
        try {
          killer = this.spawnProcess('taskkill', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])],
            { stdio: 'ignore', windowsHide: true });
        } catch (error) {
          this.log(`taskkill failed: ${error.message}`);
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          killer.kill();
          this.log('taskkill cleanup timed out');
          resolve();
        }, 2000);
        const finish = () => { clearTimeout(timer); resolve(); };
        killer.once('error', (error) => { this.log(`taskkill failed: ${error.message}`); finish(); });
        killer.once('close', finish);
      });
    } else {
      try {
        this.killGroup(-pid, force ? 'SIGKILL' : 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') this.log(`process group cleanup failed: ${error.message}`);
      }
    }
  }

  stop(code = 0) {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    this.abortController.abort();
    this.stopPromise = this.cleanup(code);
    return this.stopPromise;
  }

  async cleanup(code) {
    const trees = [...this.children];
    let timer;
    const deadline = new Promise((resolve) => { timer = setTimeout(resolve, this.graceMs); });
    try {
      await Promise.all(trees.map((record) => this.terminateTree(record, false)));
      await Promise.race([Promise.all(trees.map((record) => record.closedPromise)), deadline]);
      const stillRunning = (record) => {
        if (!record.child?.pid) return false;
        if (!record.closed) return true;
        return this.platform !== 'win32' && this.groupExists(record.child.pid);
      };
      // A watcher can close before its descendants. Preserve their remaining grace period.
      if (trees.some(stillRunning)) await deadline;
      await Promise.all(trees.filter(stillRunning).map((record) => this.terminateTree(record, true)));
      // Allow close events to settle after forceful termination, but stay bounded.
      let closeTimer;
      try {
        await Promise.race([
          Promise.all(trees.map((record) => record.closedPromise)),
          new Promise((resolve) => { closeTimer = setTimeout(resolve, 2000); }),
        ]);
      } finally {
        clearTimeout(closeTimer);
      }
      const remaining = trees.filter((record) => record.child?.pid && !record.closed);
      if (remaining.length > 0) {
        this.log(`process cleanup incomplete; roots still running: ${remaining.map((record) => record.child.pid).join(', ')}`);
        code = code || 1;
      }
    } finally {
      clearTimeout(timer);
      this.resolveDone(code);
    }
    return code;
  }
}

/** Wait for a real HTTP response, with bounded requests and cancellable retries. */
export async function waitForHttp(url, { signal, timeoutMs = 30000, expected = () => true } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([AbortSignal.timeout(1000), ...(signal ? [signal] : [])]),
      });
      if (response.ok && await expected(response)) return;
      lastError = new Error(`HTTP ${response.status} at ${url}`);
      await response.body?.cancel();
    } catch (error) {
      lastError = error;
    }
    signal?.throwIfAborted();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 100);
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  throw new Error(`timed out waiting for ${url}: ${lastError?.message ?? 'not ready'}`);
}
