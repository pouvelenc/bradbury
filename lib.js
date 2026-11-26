// Pure helpers (no DOM, no network) so they can be tested in Node.

export const TYPE_ORDER = ['poem', 'essay', 'story'];

// ---------- CSV (RFC 4180) ----------

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // strip BOM
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

function quoteField(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCSV(rows) {
  return rows.map(r => r.map(quoteField).join(',')).join('\n') + '\n';
}

export function csvObjects(text) {
  const [header, ...rows] = parseCSV(text);
  if (!header) return [];
  const keys = header.map(h => h.trim().toLowerCase());
  return rows.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

// ---------- Dates (always local time, YYYY-MM-DD) ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isISODate = s => DATE_RE.test(s);

export function isoDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

// ---------- Readings ----------

export function typeRank(type) {
  const i = TYPE_ORDER.indexOf(type);
  return i === -1 ? TYPE_ORDER.length : i;
}

// Splits a slot id like "poem2" into its type and occurrence number.
export function slotParts(slot) {
  const m = /^(.*?)(\d*)$/.exec(slot);
  return { type: m[1], n: m[2] ? Number(m[2]) : 1 };
}

export function compareSlots(a, b) {
  const pa = slotParts(a), pb = slotParts(b);
  return typeRank(pa.type) - typeRank(pb.type) || pa.type.localeCompare(pb.type) || pa.n - pb.n;
}

// Groups readings by date. Each piece gets a stable `slot` id within its day:
// the type, with a number appended for repeats ("poem", "poem2", ...).
export function groupReadings(objects) {
  const byDate = new Map();
  for (const o of objects) {
    if (!isISODate(o.date) || !o.type || !o.title) continue;
    const type = o.type.toLowerCase();
    if (!byDate.has(o.date)) byDate.set(o.date, []);
    const day = byDate.get(o.date);
    const n = day.filter(p => p.type === type).length + 1;
    day.push({ ...o, type, slot: n === 1 ? type : type + n });
  }
  for (const day of byDate.values()) day.sort((a, b) => compareSlots(a.slot, b.slot));
  return { byDate, dates: [...byDate.keys()].sort() };
}

// Which day to open when the URL has no date in it.
export function initialDate(today, dates) {
  if (dates.length && today < dates[0]) return dates[0];
  return today;
}

// Previous/next stops for navigation: every scheduled day, plus today once
// the challenge has started (so "today" is reachable even if unscheduled).
export function neighbours(current, dates, today) {
  const stops = new Set(dates);
  if (!dates.length || today >= dates[0]) stops.add(today);
  const sorted = [...stops].sort();
  let prev = null, next = null;
  for (const d of sorted) {
    if (d < current) prev = d;
    else if (d > current && next === null) next = d;
  }
  return { prev, next };
}

// ---------- Progress ----------

export const progressKey = (date, slot) => `${date}|${slot}`;

export function parseProgress(text) {
  const map = new Map();
  for (const o of csvObjects(text)) {
    if (!isISODate(o.date) || !o.type) continue;
    const rating = Number(o.rating) || 0;
    map.set(progressKey(o.date, o.type), {
      date: o.date,
      slot: o.type,
      read: o.read === '1' || o.read === 'true',
      rating: rating >= 1 && rating <= 5 ? rating : 0,
      updated: o.updated || '',
    });
  }
  return map;
}

export function serializeProgress(map) {
  const entries = [...map.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || compareSlots(a.slot, b.slot));
  return toCSV([
    ['date', 'type', 'read', 'rating', 'updated'],
    ...entries.map(e => [e.date, e.slot, e.read ? 1 : 0, e.rating || '', e.updated]),
  ]);
}

// Union of two progress maps; for keys in both, the newer `updated` wins
// (ties go to `b`).
export function mergeProgress(a, b) {
  const out = new Map(a);
  for (const [k, e] of b) {
    const cur = out.get(k);
    if (!cur || (e.updated || '') >= (cur.updated || '')) out.set(k, e);
  }
  return out;
}

// ---------- Base64 for UTF-8 text (GitHub contents API) ----------

export function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
