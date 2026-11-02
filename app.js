import {
  emptyState, dateKey, parseKey, addDays, mondayOf, daysBetween, parseEntry, savedItems, matchSaved,
  dayTotal, weekTotal, weekWeight, latestWeight, bmi, estimate, isValidBackup,
} from './logic.js';

const STORE_KEY = 'cals-state';
const app = document.getElementById('app');
const sheet = document.getElementById('sheet');
const toastEl = document.getElementById('toast');

let state = load();
let tab = 'week';
let expandedWeek = null;
let editingWeightWeek = null;
let openDay = null;
let toastTimer = null;

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...emptyState(), ...JSON.parse(raw) };
  } catch { /* fall through to a fresh start */ }
  return emptyState();
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    showToast('Could not save on this device');
  }
}

function commit(change) {
  const before = JSON.stringify(state);
  change(state);
  save();
  render();
  return () => {
    state = JSON.parse(before);
    save();
    render();
  };
}

// Small helpers
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value);
  }
  el.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

const n = (value) => Math.round(value).toLocaleString('en-US');
const today = () => dateKey(new Date());
const monthDay = (k) => parseKey(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const weekday = (k) => parseKey(k).toLocaleDateString('en-US', { weekday: 'long' });
const dayName = (k) => `${weekday(k)}, ${monthDay(k)}`;
const weekRange = (monday) => `${monthDay(monday)}–${monthDay(addDays(monday, 6))}`;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const signed = (value) => (value > 0 ? `+${n(value)}` : value < 0 ? `−${n(-value)}` : '0');

function showToast(message, undo) {
  clearTimeout(toastTimer);
  (sheet.open ? sheet : document.body).append(toastEl); // an open sheet would otherwise cover it
  toastEl.replaceChildren(h('div', { class: 'toast-body' },
    h('span', {}, message),
    undo ? h('button', { type: 'button', onclick: () => { undo(); toastEl.replaceChildren(); } }, 'Undo') : null));
  toastTimer = setTimeout(() => toastEl.replaceChildren(), undo ? 5000 : 2500);
}

function describe(entry) {
  return entry.label ? `${n(entry.cal)} ${entry.label}` : n(entry.cal);
}

function addEntry(day, cal, label) {
  const undo = commit((s) => s.entries.push({ id: uid(), d: day, cal, label }));
  showToast(`Added ${describe({ cal, label })}`, undo);
}

function removeEntry(entry) {
  const undo = commit((s) => { s.entries = s.entries.filter((e) => e.id !== entry.id); });
  showToast(`Removed ${describe(entry)}`, undo);
}

// One field for everything: "1250 panda plate". Saved labels appear below it and narrow as you type.
function combo(day) {
  const list = h('div', { class: 'combo-list', hidden: true });
  const hint = h('p', { class: 'combo-hint', hidden: true }, 'Include a number, like 1250 panda plate.');

  function showMatches() {
    hint.hidden = true;
    const items = matchSaved(savedItems(state), input.value).slice(0, 12);
    list.hidden = items.length === 0;
    list.replaceChildren(...items.map((item) => h('button', {
      type: 'button',
      class: 'combo-item',
      onclick: () => addEntry(day, item.cal, item.label),
    }, h('span', { class: 'num' }, n(item.cal)), h('span', {}, item.label))));
  }

  const input = h('input', {
    class: 'add-input',
    type: 'text',
    placeholder: 'Add calories',
    autocomplete: 'off',
    autocapitalize: 'off',
    enterKeyHint: 'done',
    'aria-label': 'Calories and optional label',
    onfocus: showMatches,
    oninput: showMatches,
  });

  const form = h('form', {
    class: 'add-form',
    onsubmit: (event) => {
      event.preventDefault();
      if (!input.value.trim()) return;
      const parsed = parseEntry(input.value);
      if (!parsed) {
        list.hidden = true;
        hint.hidden = false;
        return;
      }
      addEntry(day, parsed.cal, parsed.label);
    },
  }, input, h('button', { class: 'primary-btn', type: 'submit' }, 'Add'));

  return h('div', { class: 'combo' }, form, hint, list);
}

document.addEventListener('pointerdown', (event) => {
  const inside = event.target.closest('.combo');
  document.querySelectorAll('.combo').forEach((c) => {
    if (c !== inside) c.querySelector('.combo-list').hidden = true;
  });
});

function entryList(day) {
  const entries = state.entries.filter((e) => e.d === day);
  if (!entries.length) return h('p', { class: 'empty' }, 'Nothing logged yet.');
  return h('div', {}, entries.map((entry) => h('div', { class: 'entry' },
    h('span', { class: 'num' }, n(entry.cal)),
    h('span', { class: 'label' }, entry.label),
    h('button', {
      class: 'remove',
      type: 'button',
      'aria-label': `Remove ${describe(entry)}`,
      onclick: () => removeEntry(entry),
    }, '×'))));
}

function weightRow(monday) {
  const current = weekWeight(state, monday);
  const editing = editingWeightWeek === monday;
  const input = h('input', {
    class: 'add-input', type: 'text', inputMode: 'decimal', placeholder: 'Pounds',
    'aria-label': 'Weight in pounds', value: current ? current.lb : '',
  });
  const form = editing ? h('form', {
    class: 'weight-form',
    onsubmit: (event) => {
      event.preventDefault();
      const lb = Number(input.value.replace(',', ''));
      if (!(lb >= 50 && lb <= 1000)) return;
      editingWeightWeek = null;
      const inThisWeek = mondayOf(today()) === monday;
      const undo = commit((s) => {
        s.weights = s.weights.filter((w) => mondayOf(w.d) !== monday);
        s.weights.push({ d: current ? current.d : (inThisWeek ? today() : monday), lb });
      });
      showToast('Weight saved', undo);
    },
  }, input, h('button', { class: 'primary-btn', type: 'submit' }, 'Save')) : null;

  return h('div', {},
    h('div', { class: 'weight-row' },
      h('span', {}, 'Weight', current ? h('span', { class: 'muted' }, `  ${current.lb} lb`) : null),
      h('button', {
        class: 'link-btn',
        type: 'button',
        onclick: () => {
          editingWeightWeek = editing ? null : monday;
          render();
          if (!editing) app.querySelector('.weight-form input')?.focus();
        },
      }, editing ? 'Cancel' : current ? 'Edit' : 'Add')),
    form);
}

function shareWeek(monday) {
  const total = weekTotal(state, monday);
  const out = estimate(state).weekly;
  const inProgress = mondayOf(today()) === monday;
  const diff = out - total;
  const weight = weekWeight(state, monday);
  const lines = [
    `Week of ${monthDay(monday)}${inProgress ? ' (so far)' : ''}`,
    `${n(total)} / ${n(out)}`,
    diff >= 0 ? `${n(diff)} under` : `${n(-diff)} over`,
  ];
  if (weight) lines.push(`Weight: ${weight.lb} lb`);
  const text = lines.join('\n');
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard'), () => showToast(text));
  } else {
    showToast(text);
  }
}

function backupNudge() {
  if (!state.entries.length) return null;
  const firstDay = state.entries.reduce((a, e) => (e.d < a ? e.d : a), state.entries[0].d);
  const since = state.lastBackup || firstDay;
  if (daysBetween(since, today()) < 30) return null;
  return h('button', { class: 'link-btn small', type: 'button', onclick: openSettings },
    'It has been a while since your last backup. Back up now');
}

function setupView() {
  const input = h('input', {
    class: 'add-input', type: 'text', inputMode: 'numeric', placeholder: 'For example, 22,000',
    'aria-label': 'Calories you burn in a week',
  });
  return h('div', { class: 'card' },
    h('h2', { class: 'day-head' }, 'What do you burn in a week?'),
    h('p', { class: 'muted small' }, 'A rough guess is fine. Your weekly weigh-ins will correct it over time.'),
    h('form', {
      class: 'add-form',
      style: 'margin-top:12px',
      onsubmit: (event) => {
        event.preventDefault();
        const value = Number(input.value.replace(/,/g, ''));
        if (value >= 3000 && value <= 100000) commit((s) => { s.weeklyBase = value; });
      },
    }, input, h('button', { class: 'primary-btn', type: 'submit' }, 'Start')),
    h('button', { class: 'link-btn', type: 'button', onclick: openSettings }, 'Restore from a backup'));
}

function weekView() {
  if (state.weeklyBase == null) return setupView();
  const day = today();
  const monday = mondayOf(day);
  const total = weekTotal(state, monday);
  const out = estimate(state).weekly;
  const left = out - total;
  const daysLeft = 7 - daysBetween(monday, day);
  const perDay = left > 0 ? ` · about ${n(left / daysLeft)} a day` : '';
  const dayLabel = daysLeft === 1 ? 'last day' : `${daysLeft} days left`;

  return [
    h('section', { class: 'card', 'aria-label': 'This week' },
      h('div', { class: 'hero-head' },
        h('span', { class: 'hero-label' }, left >= 0 ? 'Left this week' : 'Over this week'),
        h('button', { class: 'share-btn', type: 'button', onclick: () => shareWeek(monday) }, 'Share')),
      h('div', { class: 'hero-number' }, n(Math.abs(left))),
      h('div', { class: 'meter', role: 'img', 'aria-label': `${n(total)} of ${n(out)} calories` },
        h('span', { style: `width:${Math.min(100, (total / out) * 100)}%` })),
      h('p', { class: 'hero-detail' }, `${n(total)} of ${n(out)}`),
      h('p', { class: 'hero-detail' }, `${dayLabel}${perDay}`)),
    combo(day),
    h('h2', { class: 'section-title row-between' },
      h('span', {}, 'Today'), h('span', {}, n(dayTotal(state, day)))),
    h('section', { class: 'card', style: 'margin-top:0' }, entryList(day)),
    h('section', { class: 'card' }, weightRow(monday)),
    backupNudge(),
  ];
}

function allWeeks() {
  const current = mondayOf(today());
  const earliest = [...state.entries.map((e) => e.d), ...state.weights.map((w) => w.d), today()].sort()[0];
  const weeks = [];
  for (let m = current; m >= mondayOf(earliest); m = addDays(m, -7)) weeks.push(m);
  return weeks;
}

function estimateCard() {
  const est = estimate(state);
  const latest = latestWeight(state);
  const value = latest ? bmi(state.heightIn, latest.lb) : null;
  const source = est.usedWeights
    ? `Based on your log and ${est.weighIns} weigh-ins`
    : 'Starting estimate. Weekly weigh-ins will refine it.';
  return h('section', { class: 'card' },
    h('p', { class: 'muted small' }, 'Calories out'),
    h('p', { class: 'stat-number' }, `About ${n(est.weekly)} a week`),
    h('p', { class: 'muted small' }, `Give or take ${n(est.range)}. ${source}`),
    value ? h('p', { class: 'muted small', style: 'margin-top:8px' }, `BMI ${value.toFixed(1)}, from your latest weight`) : null);
}

function weekRow(monday, out) {
  const total = weekTotal(state, monday);
  const isCurrent = monday === mondayOf(today());
  const expanded = expandedWeek === monday;
  const weight = weekWeight(state, monday);
  const skipped = state.incompleteWeeks.includes(monday);
  const details = [`${n(total)} in`, `${n(out)} out`];
  if (weight) details.push(`${weight.lb} lb`);

  return h('section', { class: 'card week' },
    h('button', {
      class: 'week-toggle',
      type: 'button',
      'aria-expanded': String(expanded),
      onclick: () => { expandedWeek = expanded ? null : monday; render(); },
    },
    h('div', { class: 'row-between' },
      h('span', { class: 'week-title' }, weekRange(monday), isCurrent ? h('span', { class: 'muted' }, '  so far') : null),
      h('span', { class: 'balance' }, signed(total - out))),
    h('p', { class: 'muted small' }, details.join(' · '), skipped ? ' · left out of estimate' : '')),
    expanded ? h('div', { class: 'week-body' },
      Array.from({ length: 7 }, (_, i) => addDays(monday, i))
        .filter((d) => d <= today())
        .map((d) => h('button', { class: 'day-row', type: 'button', onclick: () => openDaySheet(d) },
          h('span', {}, dayName(d)),
          h('span', { class: dayTotal(state, d) ? '' : 'muted' }, dayTotal(state, d) ? n(dayTotal(state, d)) : 'Add'))),
      weightRow(monday),
      h('label', { class: 'switch-row small' },
        h('span', {}, 'Week has missing days or rough guesses. Leave it out of the estimate.'),
        h('input', {
          type: 'checkbox',
          checked: skipped,
          onchange: (event) => commit((s) => {
            s.incompleteWeeks = s.incompleteWeeks.filter((w) => w !== monday);
            if (event.target.checked) s.incompleteWeeks.push(monday);
          }),
        })),
      h('div', { class: 'week-actions' },
        h('button', { class: 'link-btn', type: 'button', onclick: () => shareWeek(monday) }, 'Share this week'))) : null);
}

function historyView() {
  if (state.weeklyBase == null) return setupView();
  const out = estimate(state).weekly;
  return [
    estimateCard(),
    h('h2', { class: 'section-title' }, 'Week by week'),
    allWeeks().map((monday) => weekRow(monday, out)),
  ];
}

function renderDaySheet() {
  sheet.replaceChildren(h('div', {},
    h('div', { class: 'sheet-head' },
      h('h2', {}, dayName(openDay)),
      h('button', { class: 'link-btn', type: 'button', onclick: () => sheet.close() }, 'Done')),
    h('p', { class: 'muted' }, `${n(dayTotal(state, openDay))} total`),
    combo(openDay),
    h('section', { class: 'card' }, entryList(openDay))));
}

function openDaySheet(day) {
  openDay = day;
  renderDaySheet();
  sheet.showModal();
}

sheet.addEventListener('close', () => { openDay = null; });

async function saveBackup() {
  const name = `cals-backup-${today()}.json`;
  state.lastBackup = today();
  save();
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch { /* closed the share sheet */ }
  } else {
    const link = h('a', { href: URL.createObjectURL(blob), download: name });
    link.click();
    URL.revokeObjectURL(link.href);
  }
  openSettings();
  render();
}

function restore(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    showToast("That doesn't look like a Cals backup");
    return;
  }
  if (!isValidBackup(data)) {
    showToast("That doesn't look like a Cals backup");
    return;
  }
  const hasData = state.entries.length > 0;
  if (hasData && !window.confirm('Replace everything in the app with this backup?')) return;
  const undo = commit((s) => {
    Object.keys(s).forEach((key) => delete s[key]);
    Object.assign(s, emptyState(), data, { lastBackup: today() });
  });
  sheet.close();
  showToast(`Restored ${data.entries.length} entries`, undo);
}

function numberField(label, value, onValid, props = {}) {
  return h('input', {
    class: 'add-input', type: 'text', inputMode: 'numeric', value: value ?? '', 'aria-label': label,
    onchange: (event) => {
      const parsed = Number(event.target.value.replace(/,/g, ''));
      if (Number.isFinite(parsed) && parsed >= 0) onValid(parsed);
    },
    ...props,
  });
}

function openSettings() {
  const feet = state.heightIn ? Math.floor(state.heightIn / 12) : '';
  const inches = state.heightIn ? state.heightIn % 12 : '';
  const feetInput = numberField('Height, feet', feet, setHeight, { placeholder: 'Feet' });
  const inchInput = numberField('Height, inches', inches, setHeight, { placeholder: 'Inches' });
  function setHeight() {
    const total = Number(feetInput.value) * 12 + Number(inchInput.value);
    if (total >= 36 && total <= 96) commit((s) => { s.heightIn = total; });
  }

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    onchange: async (event) => {
      const file = event.target.files[0];
      if (file) restore(await file.text());
    },
  });
  const pasteBox = h('textarea', { class: 'add-input', placeholder: 'Or paste backup text here', 'aria-label': 'Backup text' });
  const saved = savedItems(state);

  sheet.replaceChildren(h('div', {},
    h('div', { class: 'sheet-head' },
      h('h2', {}, 'Settings'),
      h('button', { class: 'link-btn', type: 'button', onclick: () => sheet.close() }, 'Done')),
    h('label', { class: 'field' },
      h('span', {}, 'Starting weekly calories out'),
      numberField('Starting weekly calories out', state.weeklyBase, (value) => {
        if (value >= 3000) commit((s) => { s.weeklyBase = value; });
      })),
    h('div', { class: 'field' },
      h('span', {}, 'Height, for BMI'),
      h('div', { class: 'height-fields' }, feetInput, inchInput)),
    h('h2', { class: 'section-title' }, 'Backup'),
    h('p', { class: 'muted small' },
      'Everything lives only on this phone, and deleting the app deletes it. ',
      state.lastBackup ? `Last backup: ${monthDay(state.lastBackup)}.` : 'No backup yet.'),
    h('div', { class: 'button-row' },
      h('button', { class: 'secondary-btn', type: 'button', onclick: saveBackup }, 'Save a backup'),
      h('button', { class: 'secondary-btn', type: 'button', onclick: () => fileInput.click() }, 'Restore from a file'),
      fileInput),
    h('div', { class: 'field' }, pasteBox),
    h('div', { class: 'button-row' },
      h('button', {
        class: 'secondary-btn',
        type: 'button',
        onclick: () => { if (pasteBox.value.trim()) restore(pasteBox.value); },
      }, 'Restore from text')),
    saved.length ? h('h2', { class: 'section-title' }, 'Saved labels') : null,
    saved.length ? h('section', { class: 'card', style: 'margin-top:0' }, saved.map((item) => h('div', { class: 'entry' },
      h('span', { class: 'num' }, n(item.cal)),
      h('span', { class: 'label' }, item.label),
      h('button', {
        class: 'remove',
        type: 'button',
        'aria-label': `Remove saved label ${item.label}`,
        onclick: () => {
          commit((s) => s.hiddenSaved.push(item.key));
          openSettings();
        },
      }, '×')))) : null));
  if (!sheet.open) sheet.showModal();
}

function render() {
  const title = tab === 'week' ? 'This week' : 'History';
  app.replaceChildren(
    h('header', { class: 'topbar' },
      h('h1', {}, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Settings', onclick: openSettings, innerHTML: GEAR })),
    h('main', {}, tab === 'week' ? weekView() : historyView()),
    h('nav', { class: 'tabs', 'aria-label': 'Main' },
      [['week', 'This week'], ['history', 'History']].map(([id, label]) => h('button', {
        class: 'tab',
        type: 'button',
        ...(tab === id ? { 'aria-current': 'page' } : {}),
        onclick: () => { tab = id; window.scrollTo(0, 0); render(); },
      }, label))),
  );
  if (openDay) renderDaySheet();
}

const GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

render();

// The app can stay open overnight, so pick up the new day when it comes back.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !document.activeElement?.matches('input, textarea')) render();
});

navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
