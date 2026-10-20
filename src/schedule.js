// Every night, without being asked: slowship registers itself with the system's own scheduler, Task Scheduler on
// Windows (it runs when the laptop next wakes if it slept through the hour) and cron elsewhere. No daemon of our own.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HOME } from './state.js';

const FILE = join(HOME, 'schedule.json'), TASK = 'slowship nightly watch', MARK = '# slowship nightly watch';
const BIN = resolve(import.meta.dirname, '..', 'bin', 'slowship.js');
const LOG = join(HOME, 'nightly.log');

export const scheduleOf = () => { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return null; } };

/** The same flags the last run used, so the nightly watch reads what you read by hand. */
export const flagsOf = (o = {}) => [
  ...(o.model === false ? ['--no-model'] : []), ...(o.packages === false ? ['--agents-only'] : []), ...(o.agents === false ? ['--packages-only'] : []),
  ...(o.fetch === false ? ['--offline'] : []), ...(o.app ? ['--app', o.app] : []),
];
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
// Paths go into a .cmd file or a crontab line, so anything a shell would read as syntax is refused, not escaped.
const safe = p => { if (/["'%^&|<>`$\n\r]/.test(p)) throw new Error(`this path can't be scheduled safely: ${p}`); return p; };
const xml = s => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

/** Windows: a tiny launcher (it sets SLOWSHIP_HOME and keeps a log) and a task that runs it nightly at low priority. */
export function windowsTask(at, argv, home = HOME) {
  const [, hh, mm] = TIME.exec(at) ?? []; if (!hh) throw new Error('time must be HH:MM, 24-hour');
  const cmd = join(home, 'slowship-nightly.cmd');
  // exit 0 afterwards: a "held" verdict is news for the morning, not a failed task
  const launcher = ['@echo off', `set "SLOWSHIP_HOME=${safe(home)}"`, `${argv.map(a => `"${safe(a)}"`).join(' ')} >> "${safe(join(home, 'nightly.log'))}" 2>&1`, 'exit /b 0', ''].join('\r\n');
  const task = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>slowship: reads your packages, skills and MCP servers overnight. Never runs them.</Description></RegistrationInfo>
  <Triggers><CalendarTrigger><StartBoundary>2026-01-01T${hh}:${mm}:00</StartBoundary><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>
  <Settings><StartWhenAvailable>true</StartWhenAvailable><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><ExecutionTimeLimit>PT3H</ExecutionTimeLimit><Priority>7</Priority></Settings>
  <Actions><Exec><Command>${xml(cmd)}</Command></Exec></Actions>
</Task>`;
  return { cmd, launcher, task };
}
/** Elsewhere: one crontab line, marked so it can be found and replaced; every other line is left alone. */
export function cronLine(at, argv, home = HOME) {
  const [, hh, mm] = TIME.exec(at) ?? []; if (!hh) throw new Error('time must be HH:MM, 24-hour');
  const q = s => `'${safe(s)}'`;
  return `${+mm} ${+hh} * * * SLOWSHIP_HOME=${q(home)} ${argv.map(q).join(' ')} >> ${q(join(home, 'nightly.log'))} 2>&1 ${MARK}`;
}

export function schedule({ project, at = '03:00', options = {} }) {
  mkdirSync(HOME, { recursive: true });
  const argv = [process.execPath, BIN, safe(resolve(project)), ...flagsOf(options)];
  if (process.platform === 'win32') {
    const { cmd, launcher, task } = windowsTask(at, argv), file = join(HOME, 'slowship-nightly.xml');
    writeFileSync(cmd, launcher);
    writeFileSync(file, Buffer.from('﻿' + task, 'utf16le'));  // schtasks reads task XML as UTF-16
    try { execFileSync('schtasks', ['/Create', '/TN', TASK, '/XML', file, '/F'], { stdio: 'pipe' }); }
    finally { rmSync(file, { force: true }); }
  } else {
    let cur = '';
    try { cur = execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch {}
    const next = cur.split('\n').filter(l => l.trim() && !l.includes(MARK)).concat(cronLine(at, argv)).join('\n') + '\n';
    execFileSync('crontab', ['-'], { input: next });
  }
  const s = { project: resolve(project), at, options, since: new Date().toISOString(), log: LOG };
  writeFileSync(FILE, JSON.stringify(s, null, 1));
  return s;
}

export function unschedule() {
  if (process.platform === 'win32') { try { execFileSync('schtasks', ['/Delete', '/TN', TASK, '/F'], { stdio: 'pipe' }); } catch {} rmSync(join(HOME, 'slowship-nightly.cmd'), { force: true }); }
  else {
    let cur = '';
    try { cur = execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch {}
    if (cur.includes(MARK)) execFileSync('crontab', ['-'], { input: cur.split('\n').filter(l => l.trim() && !l.includes(MARK)).join('\n') + '\n' });
  }
  if (existsSync(FILE)) rmSync(FILE);
}
