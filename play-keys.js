// lifted from slowship's src/agents.js at build time, unchanged
window.SLOWSHIP_KEYS = (() => {
// ---------- who can spend your money ----------
// Keys to outside accounts that an agent's tools read in their code or are handed in an editor's MCP config. Each can
// run up a bill or act as you. Only names are kept: a key's value is never read.
// known accounts, anywhere in the name: REMOTION_AWS_ACCESS_KEY_ID is an AWS key
const SERVICE = [[/(^|_)OPENAI_/, 'OpenAI'], [/(^|_)(GEMINI|GOOGLE_(AI|GENAI))_/, 'Google Gemini'], [/^GOOGLE_APPLICATION_CREDENTIALS$/, 'Google Cloud'],
  [/(^|_)GOOGLE_/, 'Google'], [/(^|_)AWS_/, 'AWS'], [/(^|_)AZURE_/, 'Azure'], [/(^|_)(GITHUB|GH)_/, 'GitHub'], [/(^|_)(HF|HUGGING_?FACE(_HUB)?)_/, 'Hugging Face'],
  [/(^|_)ELEVEN_?LABS_/, 'ElevenLabs'], [/(^|_)HEYGEN_/, 'HeyGen'], [/(^|_)NPM_/, 'npm'], [/(^|_)OPENROUTER_/, 'OpenRouter']];
const SUFFIX = /_?(API_?KEY|ACCESS_?TOKEN|AUTH_?TOKEN|SECRET(_?KEY)?|TOKEN|PASSWORD|PASSWD|PRIVATE_?KEY|CREDENTIALS?|KEY)$/i;
// a key's name ends in what it is: MAX_TOKENS or LOG_TOKENS isn't a key, GITHUB_TOKEN and AWS_ACCESS_KEY_ID are
const KEY_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|_KEY|CREDENTIALS?|_AUTH|ACCESS_KEY_ID)$/i;
const AUTH_HEADER = /^(authorization|x-api-key|api-key|x-auth-token)$/i;
const givenKeys = (names, server) => [...new Set(names.filter(n => KEY_NAME.test(n) || AUTH_HEADER.test(n)))].map(name => ({ name, service: serviceOf(name, server) }));
/** A readable name for whatever a key belongs to: known ones by prefix, the rest from the name (TINKER_API_KEY → Tinker). */
function serviceOf(key, server = '') {
  if (AUTH_HEADER.test(key)) return server || 'its server';
  const hit = SERVICE.find(([re]) => re.test(key));
  if (hit) return hit[1];
  const base = key.replace(SUFFIX, '') || key;
  return base.toLowerCase().split('_').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}
/** The secret keys a tool's own code reads, from its facts: [{ name, service, file, line }], one per key. */
function keysFrom(facts, named = []) {
  const out = new Map();
  for (const f of facts) {
    if (f.cap !== 'env-secret') continue;
    for (const [name] of `${f.detail} ${f.code}`.matchAll(/\b[A-Z][A-Z0-9_]*\b/g))
      if (isKey(name) && !out.has(name)) out.set(name, { name, service: serviceOf(name), file: f.file, line: f.line });
  }
  for (const k of named) if (!out.has(k.name)) out.set(k.name, k);  // what its code reads comes first
  return [...out.values()];
}
// a key needs a name before what it is: OPENAI_API_KEY is one, a bare API_KEY placeholder in the docs isn't
const isKey = name => KEY_NAME.test(name) && /^[A-Z][A-Z0-9_]+$/.test(name) && name.replace(SUFFIX, '') !== '';
/** Keys a skill's instructions tell the agent to use ("Set ELEVENLABS_API_KEY, then call the API"). */
function keysNamed(text, file) {
  const out = [];
  text.split(/\r?\n/).forEach((l, i) => {
    for (const [name] of l.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g))
      if (isKey(name) && !out.some(k => k.name === name)) out.push({ name, service: serviceOf(name), file, line: i + 1, how: 'docs' });
  });
  return out;
}


return { keysNamed, serviceOf, givenKeys };
})();
