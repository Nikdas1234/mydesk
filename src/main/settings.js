const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'settings.json';

const DEFAULTS = Object.freeze({
  downloadsMaxAgeDays: 90,
  mailSinceDays: 90,
  importantKeywords: [
    'Rechnung', 'Mahnung', 'Zahlungserinnerung', 'Termin', 'Vertrag', 'Kündigung', 'Frist',
    'Bescheid', 'Sicherheit', 'Passwort', 'Anmeldung', 'Lieferung', 'Bestellung',
  ],
  theme: 'system',
  style: 'classic',
  userName: '',
  homeGreeting: true,
  homeClock: true,
  homeSummary: true,
  homeTip: true,
  animations: true,
  autoCheckOnStart: false,
  sidebarExpanded: false,
  hiddenTiles: [],
  lastSeenVersion: '',
});

const isStringList = (v) => Array.isArray(v) && v.every((entry) => typeof entry === 'string');

// One validator per known key. Each returns true if the value is acceptable.
const VALIDATORS = {
  downloadsMaxAgeDays: (v) => Number.isInteger(v) && v >= 1 && v <= 3650,
  theme: (v) => ['system', 'light', 'dark'].includes(v),
  style: (v) => ['classic', 'tinted', 'glass'].includes(v),
  userName: (v) => typeof v === 'string' && v.length <= 40,
  homeGreeting: (v) => typeof v === 'boolean',
  homeClock: (v) => typeof v === 'boolean',
  homeSummary: (v) => typeof v === 'boolean',
  homeTip: (v) => typeof v === 'boolean',
  animations: (v) => typeof v === 'boolean',
  autoCheckOnStart: (v) => typeof v === 'boolean',
  sidebarExpanded: (v) => typeof v === 'boolean',
  hiddenTiles: isStringList,
  lastSeenVersion: (v) => typeof v === 'string' && v.length <= 20,
  mailSinceDays: (v) => Number.isInteger(v) && v >= 1 && v <= 3650,
  importantKeywords: isStringList,
};

function defaultValue(key) {
  const value = DEFAULTS[key];
  return Array.isArray(value) ? [...value] : value;
}

// Builds a complete Settings object: unknown keys are dropped, missing or
// invalid fields fall back to their default.
function normalize(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const result = {};
  for (const key of Object.keys(DEFAULTS)) {
    const value = source[key];
    if (VALIDATORS[key](value)) {
      result[key] = Array.isArray(value) ? [...value] : value;
    } else {
      result[key] = defaultValue(key);
    }
  }
  return result;
}

function createSettingsStore(dir) {
  const filePath = path.join(dir, FILE_NAME);

  function load() {
    try {
      return normalize(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch {
      // missing or unreadable or corrupt file: use defaults
      return normalize(null);
    }
  }

  function save(patch) {
    const merged = normalize({ ...load(), ...(patch ?? {}) });
    fs.mkdirSync(dir, { recursive: true });
    // Write to a temp file first, then rename, so an interrupted write
    // cannot leave a half-written settings file behind.
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      fs.rmSync(tmpPath, { force: true });
      throw err;
    }
    return merged;
  }

  return { load, save };
}

module.exports = { createSettingsStore };
