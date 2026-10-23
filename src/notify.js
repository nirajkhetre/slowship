// The morning ping: the verdict, sent where you'll see it. A Discord channel (through a webhook you make) or a Telegram
// chat (through a bot you make). Off unless you connect one. Only a summary leaves this computer: the verdict, the
// counts, the names of what needs you and slowship's own words for why. Never code, file paths, key names, or any
// text a scanned package wrote. The webhook and the token stay in a file only you can read; pages see a hint.
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { HOME } from './state.js';

const FILE = join(HOME, 'notify.json');
export const DISCORD = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/(\d{15,22})\/[\w-]{50,100}$/;
export const TG_TOKEN = /^\d{6,12}:[\w-]{30,50}$/;

export const config = () => { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return {}; } };
function keep(c) {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(FILE, JSON.stringify(c, null, 1), { mode: 0o600 });
  try { chmodSync(FILE, 0o600); } catch { /* Windows: the file sits in your own profile */ }
  return c;
}

/** What a page or the terminal may see: what's on, and a hint to recognise it by. Never a webhook or a token. */
export function status(c = config()) {
  const id = c.discord?.webhook?.match(DISCORD)?.[1];
  return {
    discord: id ? { on: true, hint: `webhook …${id.slice(-4)}` } : { on: false },
    telegram: c.telegram?.token ? { on: !!c.telegram.chat, bot: c.telegram.bot ?? null, chat: c.telegram.chatName ?? null } : { on: false },
    when: c.when ?? 'always', manual: !!c.manual,
  };
}

export function setDiscord(url) {
  url = String(url ?? '').trim();
  if (!DISCORD.test(url)) throw new Error('That isn\'t a Discord webhook link. It starts with https://discord.com/api/webhooks/');
  return status(keep({ ...config(), discord: { webhook: url } }));
}

/** Telegram's API, at its one address. Errors say what Telegram said, never the token. */
async function tg(token, method, body, fetch, ms = 15_000) {
  if (!TG_TOKEN.test(token)) throw new Error('That isn\'t a bot token');
  let r;
  try { r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }); }
  catch (e) { throw new Error(e.name === 'TimeoutError' ? 'Telegram didn\'t answer in time' : 'Couldn\'t reach Telegram. Is this computer online?'); }
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.description ? `Telegram says: ${j.description}` : `Telegram answered ${r.status}`);
  return j.result;
}

export async function setTelegram(token, { fetch = globalThis.fetch } = {}) {
  token = String(token ?? '').trim();
  if (!TG_TOKEN.test(token)) throw new Error('That isn\'t a bot token. BotFather gives one like 123456789:AAH…');
  const me = await tg(token, 'getMe', {}, fetch);  // the token works, and this is the bot's name
  return status(keep({ ...config(), telegram: { token, bot: me.username } }));
}

/** After you press Start in your bot's chat, the newest message to it says which chat to write to. */
export async function findChat({ fetch = globalThis.fetch, wait = 20 } = {}) {
  const c = config(), token = c.telegram?.token;
  if (!token) throw new Error('Connect the bot first');
  const ups = await tg(token, 'getUpdates', { timeout: wait, allowed_updates: ['message'] }, fetch, (wait + 10) * 1000);
  const m = [...ups].reverse().find(u => u.message?.chat)?.message;
  if (!m) return { found: false, ...status(c) };
  const chatName = m.chat.title || m.chat.first_name || m.chat.username || 'your chat';
  return { found: true, ...status(keep({ ...c, telegram: { ...c.telegram, chat: m.chat.id, chatName } })) };
}

export function off(platform) {
  if (platform === 'all') { rmSync(FILE, { force: true }); return status({}); }
  if (!['discord', 'telegram'].includes(platform)) throw new Error('discord, telegram or all');
  const c = config(); delete c[platform];
  return status(keep(c));
}

export function prefs({ when, manual } = {}) {
  const c = config();
  if (when !== undefined) { if (!['always', 'needs'].includes(when)) throw new Error('when: always or needs'); c.when = when; }
  if (manual !== undefined) c.manual = !!manual;
  return status(keep(c));
}

// ---------- the message: slowship's words only ----------
const ORDER = { info: 0, notable: 1, review: 2, hold: 3 };
// a single fact's own detail can carry text a package wrote (a script, a URL), so a single fact is named by its kind
const PHRASE = {
  net: 'makes network calls', exec: 'runs programs', code: 'builds code at runtime', 'fs-write': 'writes files', 'install-script': 'runs code at install',
  'env-secret': 'reads a secret from the environment', 'secret-path': 'touches credential files', 'persist-path': 'touches autostart places',
  'dynamic-load': 'loads code by a computed name', obfuscated: 'carries an encoded blob', 'hidden-chars': 'has hidden characters',
  conceal: 'tells your agent to keep something from you', override: 'tells your agent to ignore its other instructions',
  secret: 'ships a secret in your build', 'secret-maybe': 'may ship a secret in your build', 'env-file': 'ships a .env file', sourcemap: 'ships a source map',
  'electron-node': 'turns on Node.js in a window', 'electron-isolation-off': 'turns off context isolation', 'electron-websec-off': 'turns off web security',
  'ipc-unchecked': 'has an IPC handler that doesn\'t check its sender', 'fuse-node': 'ships with Electron fuses open', keys: 'can watch keystrokes',
  inject: 'writes into other programs\' memory', dpapi: 'decrypts what Windows protects', 'swapped-dep': 'was built with a swapped dependency',
  autorun: 'runs a command on its own when the project opens', 'autorun-allowed': 'lets VS Code run tasks without asking', 'stray-script': 'keeps a script in a settings folder',
  storm: 'is caught in a known storm', malicious: 'is a known malicious package', eol: 'runs on something no one fixes any more', floating: 'gets fixes only when rebuilt',
};
// Storm watch writes these sentences itself, from advisory ids and version numbers: safe to say as they are
const OWN = new Set(['storm', 'malicious', 'eol', 'floating']);
const VERDICT = { hold: 'Held in port.', review: 'Ready after a glance.', ok: 'Cleared to sail.' };
const MARK = { hold: '◆', review: '●', ok: '✓' };
/** A finding in slowship's words: combinations are its own sentences, a single fact is named by its kind. */
export const said = f => f.evidence?.length > 1 || OWN.has(f.kind) ? f.says : PHRASE[f.kind] ?? 'is worth a look';

/** The run as a ping: verdict, counts, the first five that need you. */
export function summary(run, { test = false } = {}) {
  const by = new Map();
  for (const i of run?.items ?? []) if (!by.has(i.fp)) by.set(i.fp, i);
  const G = [...by.values()], open = G.filter(i => !i.approved && ORDER[i.level] >= 2).sort((a, b) => ORDER[b.level] - ORDER[a.level]);
  const held = open.filter(i => i.level === 'hold').length, level = held ? 'hold' : open.length ? 'review' : 'ok';
  const why = i => {
    const f = i.findings?.find(f => ORDER[f.level] >= 2);
    return (f ? said(f) : 'is worth a look').slice(0, 140);
  };
  return {
    level, title: VERDICT[level], held, glance: open.length - held, aboard: G.length, test,
    project: basename(String(run?.options?.project || run?.project || '')) || 'your project',
    items: open.slice(0, 5).map(i => ({ name: (i.kind === 'npm' ? i.key.replace(/^npm:/, '') : i.kind === 'dep' ? `${i.name}@${i.version}` : i.name).slice(0, 80), level: i.level, why: why(i) })),
    more: Math.max(0, open.length - 5), at: run?.finished || new Date().toISOString(),
  };
}

const md = s => String(s).replace(/([\\`*_~|>#[\]()@<:-])/g, '\\$1');  // Discord markdown read as text
export function discordBody(s) {
  const lines = s.items.map(i => `${MARK[i.level === 'hold' ? 'hold' : 'review']} **${md(i.name)}** · ${md(i.why)}`);
  if (s.more) lines.push(`and ${s.more} more`);
  return {
    username: 'slowship', allowed_mentions: { parse: [] },  // a package called @everyone pings nobody
    embeds: [{
      title: `${MARK[s.level]} ${s.title}`, color: { hold: 0xA92172, review: 0xEB9F2C, ok: 0x0C8A5E }[s.level],
      description: [`**${s.held}** held · **${s.glance}** to glance · ${s.aboard} aboard`, ...(lines.length ? ['', ...lines] : [])].join('\n'),
      footer: { text: `${s.test ? 'A test from slowship · ' : ''}${s.project} · read, never run · open it with: slowship review` }, timestamp: s.at,
    }],
  };
}
const h = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
export function telegramText(s) {
  return [`<b>${MARK[s.level]} ${h(s.title)}</b>`, `${s.held} held · ${s.glance} to glance · ${s.aboard} aboard in ${h(s.project)}`,
    ...(s.items.length ? ['', ...s.items.map(i => `${MARK[i.level === 'hold' ? 'hold' : 'review']} <b>${h(i.name)}</b> · ${h(i.why)}`)] : []),
    ...(s.more ? [`and ${s.more} more`] : []), '', `<i>${s.test ? 'A test from slowship. ' : ''}Read, never run. Open it with: slowship review</i>`].join('\n');
}

/** Send the summary to whatever is connected (or only one). { discord: {ok, error}, telegram: {ok, error} } */
export async function send(s, { only, fetch = globalThis.fetch, c = config() } = {}) {
  const out = {};
  if (c.discord?.webhook && (!only || only === 'discord')) {
    out.discord = await (async () => {
      if (!DISCORD.test(c.discord.webhook)) throw new Error('the saved webhook isn\'t a Discord webhook');
      let r;
      try { r = await fetch(`${c.discord.webhook}?wait=true`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(discordBody(s)), signal: AbortSignal.timeout(15_000) }); }
      catch { throw new Error('Couldn\'t reach Discord. Is this computer online?'); }
      if (!r.ok) throw new Error(r.status === 404 ? 'Discord says this webhook was deleted. Make a new one.' : `Discord answered ${r.status}`);
    })().then(() => ({ ok: true }), e => ({ ok: false, error: e.message }));
  }
  if (c.telegram?.chat && (!only || only === 'telegram'))
    out.telegram = await tg(c.telegram.token, 'sendMessage', { chat_id: c.telegram.chat, text: telegramText(s), parse_mode: 'HTML', disable_web_page_preview: true }, fetch)
      .then(() => ({ ok: true }), e => ({ ok: false, error: e.message }));
  return out;
}

/** After a watch: send when something is connected and this is a watch you asked to hear about. Never throws. */
export async function after(run, { manual = false, fetch, c = config() } = {}) {
  if (!c.discord?.webhook && !c.telegram?.chat) return null;
  if (manual && !c.manual) return null;
  const s = summary(run);
  if ((c.when ?? 'always') === 'needs' && s.level === 'ok') return null;
  try { return await send(s, { c, ...(fetch ? { fetch } : {}) }); } catch { return null; }
}
