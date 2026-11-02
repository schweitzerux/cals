// Pure calculations. No page or storage access, so these can be tested on their own.

export const CAL_PER_LB = 3500;
const PRIOR_RANGE = 2300; // about 10% of a typical weekly number
const WEIGH_IN_NOISE_LB = 1.5; // typical water swing in one reading
const ESTIMATE_WINDOW = 12; // most recent weigh-ins used

export const emptyState = () => ({
  v: 1, weeklyBase: null, heightIn: null, entries: [], weights: [],
  incompleteWeeks: [], hiddenSaved: [], lastBackup: null,
});

const pad = (n) => String(n).padStart(2, '0');
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
export const mondayOf = (k) => addDays(k, -((parseKey(k).getDay() + 6) % 7));
export const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);

// "1250 panda plate", "Chipotle bowl 900", "1,250". A trailing number wins only if it is the
// larger one, so "2 eggs 140" is 140 calories of "2 eggs".
export function parseEntry(text) {
  const clean = String(text).trim().replace(/(\d),(?=\d{3}\b)/g, '$1');
  const start = clean.match(/^(\d+)(?:\s+(.*))?$/);
  const end = clean.match(/^(.*\S)\s+(\d+)$/);
  let cal = null; let label = '';
  if (start) { cal = Number(start[1]); label = start[2] || ''; }
  if (end && (cal === null || Number(end[2]) > cal)) { cal = Number(end[2]); label = end[1]; }
  if (cal === null || cal < 1 || cal > 20000) return null;
  return { cal, label: label.trim() };
}

const savedKey = (cal, label) => `${cal}|${label.toLowerCase()}`;

// Every labeled entry becomes a saved item, most used first.
export function savedItems(state) {
  const map = new Map();
  for (const e of state.entries) {
    if (!e.label) continue;
    const key = savedKey(e.cal, e.label);
    if (state.hiddenSaved.includes(key)) continue;
    const item = map.get(key) || { key, cal: e.cal, label: e.label, count: 0, last: '' };
    item.count += 1;
    if (e.d >= item.last) { item.last = e.d; item.label = e.label; }
    map.set(key, item);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));
}

export function matchSaved(items, query) {
  const q = query.trim().toLowerCase().replace(/,/g, '');
  if (!q) return items;
  return items.filter((i) => `${i.cal} ${i.label.toLowerCase()}`.includes(q) || i.label.toLowerCase().includes(q));
}

export function dayTotal(state, day) {
  return state.entries.filter((e) => e.d === day).reduce((sum, e) => sum + e.cal, 0);
}

export function weekTotal(state, monday) {
  const end = addDays(monday, 7);
  return state.entries.filter((e) => e.d >= monday && e.d < end).reduce((sum, e) => sum + e.cal, 0);
}

export function weekWeight(state, monday) {
  const end = addDays(monday, 7);
  return state.weights.find((w) => w.d >= monday && w.d < end) || null;
}

export function latestWeight(state) {
  return [...state.weights].sort((a, b) => a.d.localeCompare(b.d)).pop() || null;
}

export function bmi(heightIn, lb) {
  return heightIn && lb ? (703 * lb) / (heightIn * heightIn) : null;
}

// Fits a line through recent weigh-ins, turns it into calories out using logged intake, then
// blends that with the starting number by how much each can be trusted. One week barely moves it.
export function estimate(state) {
  const prior = state.weeklyBase;
  const weights = [...state.weights].sort((a, b) => a.d.localeCompare(b.d)).slice(-ESTIMATE_WINDOW);
  const base = { weekly: prior, range: PRIOR_RANGE, weighIns: state.weights.length, usedWeights: false };
  if (weights.length < 2 || prior == null) return base;

  const first = weights[0].d; const last = weights[weights.length - 1].d;
  const span = daysBetween(first, last);
  if (span < 7) return base;

  const totals = new Map();
  for (const e of state.entries) {
    if (e.d < first || e.d >= last) continue;
    if (state.incompleteWeeks.includes(mondayOf(e.d))) continue;
    totals.set(e.d, (totals.get(e.d) || 0) + e.cal);
  }
  if (totals.size < span / 2) return base;
  const avgWeekly = ([...totals.values()].reduce((a, b) => a + b, 0) / totals.size) * 7;

  const xs = weights.map((w) => daysBetween(first, w.d) / 7);
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const yMean = weights.reduce((a, w) => a + w.lb, 0) / weights.length;
  const sxx = xs.reduce((a, x) => a + (x - xMean) ** 2, 0);
  const slope = xs.reduce((a, x, i) => a + (x - xMean) * (weights[i].lb - yMean), 0) / sxx;

  const measured = avgWeekly - slope * CAL_PER_LB;
  const measuredRange = (WEIGH_IN_NOISE_LB / Math.sqrt(sxx)) * CAL_PER_LB;
  const pw = 1 / PRIOR_RANGE ** 2; const mw = 1 / measuredRange ** 2;
  return {
    weekly: Math.round(((prior * pw + measured * mw) / (pw + mw)) / 100) * 100,
    range: Math.round(Math.sqrt(1 / (pw + mw)) / 100) * 100,
    weighIns: state.weights.length,
    usedWeights: true,
  };
}

export function isValidBackup(data) {
  return Boolean(data) && data.v === 1 && Array.isArray(data.entries) && Array.isArray(data.weights)
    && data.entries.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.d) && Number.isFinite(e.cal));
}
