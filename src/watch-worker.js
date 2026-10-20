// One watch, run off the report server's thread: finding the cargo and reading it can take the CPU for seconds,
// and the page should still answer every click and poll at once. Progress goes back as small messages.
import { parentPort, workerData } from 'node:worker_threads';
import { scanProject } from './scan.js';

const { project, options } = workerData;
const slim = i => ({ key: i.key, name: i.name, kind: i.kind, level: i.level, approved: i.approved });
scanProject(project, {
  ...options,
  onStep: s => parentPort.postMessage({ type: 'step', step: { key: s.key, name: s.name, kind: s.kind, phase: s.phase } }),
  onItem: (item, n, how) => parentPort.postMessage({ type: 'item', item: slim(item), n, how }),
})
  .then(run => parentPort.postMessage({ type: 'done', run }))
  .catch(e => parentPort.postMessage({ type: 'error', message: String(e?.message ?? e) }));
