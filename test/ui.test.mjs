import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as engine from '../src/surgeEngine.js';

// Run the production controller against an actual DOM. Only its CSS/module
// loader and audio output are replaced; game rules and all event handlers run.
const source = (await readFile(new URL('../src/main.js', import.meta.url), 'utf8'))
  .replace(/^import '\.\/style\.css';\s*/m, '')
  .replace(/^import \{([^}]+)\} from '\.\/surgeEngine\.js';\s*/m, 'const {$1} = window.__engine;\n')
  .replace(/^import \{ sound \} from '\.\/audio\.js';\s*/m, 'const sound = window.__sound;\n')
  .replaceAll('import.meta.env.PROD', 'false');

function setup(t, saved = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error));
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'https://sumsurge.test/', runScripts: 'outside-only', virtualConsole,
  });
  const { window } = dom;
  const { document } = window;
  let now = 1000;
  let wallEpoch = Date.parse('2026-11-11T12:00:00Z') - now;
  let nextTask = 1;
  let pointingAt = null;
  const timers = new Map();
  const frames = new Map();
  const captures = new Set();
  const audioCalls = [];
  const sound = {};
  for (const name of ['unlock', 'start', 'stop', 'play', 'setEnabled', 'setMusicEnabled', 'setIntensity']) {
    sound[name] = (...args) => audioCalls.push({ name, args });
  }
  window.__engine = engine;
  window.__sound = sound;
  window.Math.random = engine.createRng('integration-session');
  const NativeDate = window.Date;
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [wallEpoch + now])); }
    static now() { return wallEpoch + now; }
  };
  Object.defineProperty(window.performance, 'now', { value: () => now });
  window.requestAnimationFrame = (callback) => { const id = nextTask++; frames.set(id, callback); return id; };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  window.setTimeout = (callback, delay = 0) => { const id = nextTask++; timers.set(id, { at: now + delay, callback }); return id; };
  window.clearTimeout = (id) => timers.delete(id);
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.querySelector('button')?.focus(); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  window.HTMLElement.prototype.setPointerCapture = (id) => captures.add(id);
  window.HTMLElement.prototype.hasPointerCapture = (id) => captures.has(id);
  window.HTMLElement.prototype.releasePointerCapture = (id) => captures.delete(id);
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const index = this.hasAttribute('data-index') ? Number(this.dataset.index) : null;
    const left = index === null ? 0 : (index % 5) * 100 + 5;
    const top = index === null ? 0 : Math.floor(index / 5) * 100 + 5;
    const size = index === null ? 500 : 90;
    return { left, top, x: left, y: top, width: size, height: size, right: left + size, bottom: top + size };
  };
  document.elementFromPoint = () => pointingAt;
  for (const [key, value] of Object.entries(saved)) window.localStorage.setItem(key, value);
  window.eval(source);

  const $ = (selector) => document.querySelector(selector);
  const all = (selector) => [...document.querySelectorAll(selector)];
  const tile = (index) => $(`[data-index="${index}"]`);
  const click = (selector) => { const element = $(selector); assert.ok(element, `Missing control ${selector}`); element.click(); };
  function advance(milliseconds) {
    const end = now + milliseconds;
    // Small frames model normal browser time; paused runs still receive frames.
    while (now < end) {
      now = Math.min(end, now + 50);
      for (;;) {
        const pending = [...timers.entries()].filter(([, task]) => task.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!pending) break;
        timers.delete(pending[0]); pending[1].callback();
      }
      const callbacks = [...frames.values()]; frames.clear();
      for (const callback of callbacks) callback(now);
    }
  }
  function key(element, key) {
    element.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }
  function keyboardPick(index) {
    if (!document.activeElement?.matches('.tile')) $('#board .tile[tabindex="0"]').focus();
    while (Number(document.activeElement.dataset.index) % 5 !== index % 5) {
      key(document.activeElement, Number(document.activeElement.dataset.index) % 5 < index % 5 ? 'ArrowRight' : 'ArrowLeft');
    }
    while (Math.floor(Number(document.activeElement.dataset.index) / 5) !== Math.floor(index / 5)) {
      key(document.activeElement, Number(document.activeElement.dataset.index) < index ? 'ArrowDown' : 'ArrowUp');
    }
    // Browsers generate a detail=0 click for Space/Enter. JSDOM has no keyboard
    // default actions, so trigger that native activation after moving focus.
    document.activeElement.click();
  }
  function pointer(type, index, pointerType = 'touch') {
    pointingAt = index === null ? null : tile(index);
    const event = new window.MouseEvent(type, { button: 0, bubbles: true, cancelable: true, clientX: 20, clientY: 20 });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
    (pointingAt || $('#board')).dispatchEvent(event);
  }
  function boardSnapshot() {
    return all('.tile').map((el) => ({ id: Number(el.dataset.id), value: Number(el.querySelector('.tile-number').textContent), charged: el.classList.contains('charged') }));
  }
  function targets() { return all('.target-chip').map((el) => Number(el.textContent)); }
  function hintPath() {
    return all('.tile.hinted').sort((a, b) => Number(a.querySelector('.tile-step').textContent) - Number(b.querySelector('.tile-step').textContent)).map((el) => Number(el.dataset.index));
  }
  function solution() {
    const board = boardSnapshot();
    const offered = targets();
    // Ask the real engine for routes until it proposes an offered target.
    // This drives controls without reaching into the controller's private state.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const route = engine.findTargets(board, engine.createRng(`ui-solver-${attempt}`)).find((candidate) => offered.includes(candidate.value));
      if (route) {
        click(`[data-target="${offered.indexOf(route.value)}"]`);
        return route.path;
      }
    }
    assert.fail('The offered targets should have a discoverable route');
  }
  function clear({ settle = true } = {}) {
    const path = solution();
    for (const index of path) keyboardPick(index);
    if (settle) advance(300);
    return path;
  }
  const storage = () => Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, i) => {
    const key = window.localStorage.key(i); return [key, window.localStorage.getItem(key)];
  }));
  t.after(() => { dom.window.close(); assert.deepEqual(errors, [], 'UI event handlers must not throw'); });
  return { window, document, $, all, tile, click, advance, key, keyboardPick, pointer, boardSnapshot, targets, hintPath, clear, storage, audioCalls,
    setDate: (date) => { wallEpoch = Date.parse(date) - now; },
  };
}

test('first touch input keeps the visible board and chosen target, then supports backtracking and cancellation', (t) => {
  const ui = setup(t);
  const before = ui.boardSnapshot();
  ui.click('[data-target="2"]');
  const chosen = ui.$('.target-chip.selected').textContent;
  ui.pointer('pointerdown', 0);
  assert.deepEqual(ui.boardSnapshot(), before);
  assert.equal(ui.$('.target-chip.selected').textContent, chosen);
  assert.equal(ui.$('#pauseBtn').disabled, false);
  ui.pointer('pointermove', 6);
  assert.equal(ui.all('.tile.selected').length, 2, 'Diagonal touch movement extends a route');
  ui.pointer('pointermove', 0);
  assert.equal(ui.all('.tile.selected').length, 1, 'Moving back one tile undoes a step');
  ui.pointer('pointercancel', null);
  assert.equal(ui.all('.tile.selected').length, 0);
  ui.pointer('pointerdown', 24);
  assert.equal(ui.tile(24).getAttribute('aria-pressed'), 'true', 'Cancellation releases the input for another touch');
  ui.pointer('pointerup', 24);
});

test('hint remains numbered while following it, clears a target, refills, and keeps keyboard focus', (t) => {
  const ui = setup(t);
  ui.click('#hintBtn');
  const path = ui.hintPath();
  assert.ok(path.length >= 2);
  assert.equal(ui.$('#hintCount').textContent, '2');
  ui.keyboardPick(path[0]);
  assert.equal(ui.all('.tile.hinted').length, path.length, 'The remaining hint must survive the first selection');
  for (const index of path.slice(1)) ui.keyboardPick(index);
  assert.ok(Number(ui.$('#score').textContent.replace(/\D/g, '')) > 0);
  assert.ok(ui.all('.tile.clearing').length >= 2);
  ui.advance(300);
  assert.equal(ui.all('.tile').length, 25);
  assert.equal(ui.all('.tile.selected,.tile.hinted,.tile.clearing').length, 0);
  assert.ok(ui.document.activeElement.matches('.tile'), 'Keyboard play continues after the refill');
  assert.equal(ui.all('.tile[tabindex="0"]').length, 1);
  ui.key(ui.document.activeElement, 'ArrowLeft');
  assert.ok(ui.document.activeElement.matches('.tile'));
  ui.click('#hintBtn');
  assert.ok(ui.hintPath().length >= 2);
  ui.advance(4050);
  assert.equal(ui.all('.tile.hinted').length, 0, 'Hints expire without leaving a highlighted route');
});

test('pause and instructions freeze the timer, combo window, and surge duration', (t) => {
  const ui = setup(t);
  ui.click('#startBtn');
  for (let i = 0; i < 5; i += 1) ui.clear();
  assert.ok(ui.document.body.classList.contains('surging'));
  assert.match(ui.$('#comboLabel').textContent, /5/);
  const clock = ui.$('#clock').textContent;
  const surge = ui.$('#chargeLabel').textContent;
  ui.click('#pauseBtn');
  assert.equal(ui.$('#gameDialog').open, true);
  ui.advance(15000);
  assert.equal(ui.$('#clock').textContent, clock);
  ui.click('#resumeBtn');
  assert.equal(ui.$('#gameDialog').open, false);
  assert.equal(ui.$('#chargeLabel').textContent, surge, 'Paused time cannot consume the surge');
  assert.ok(ui.document.body.classList.contains('surging'));
  assert.match(ui.$('#comboLabel').textContent, /5/);
  ui.click('#howToBtn');
  ui.advance(10000);
  assert.equal(ui.$('#clock').textContent, clock);
  ui.click('#helpDone');
  ui.advance(1100);
  assert.notEqual(ui.$('#clock').textContent, clock, 'The timer resumes after closing instructions');
});

test('hints and shuffles spend their limited uses and reset the combo without changing the score', (t) => {
  const ui = setup(t);
  ui.click('#startBtn');
  ui.clear(); ui.clear();
  assert.match(ui.$('#comboLabel').textContent, /2/);
  const score = ui.$('#score').textContent;
  ui.click('#hintBtn');
  assert.match(ui.$('#comboLabel').textContent, /1/);
  assert.equal(ui.$('#score').textContent, score);
  ui.clear(); ui.clear();
  assert.match(ui.$('#comboLabel').textContent, /2/);
  const before = ui.boardSnapshot().sort((a, b) => a.id - b.id);
  const beforeShuffleScore = ui.$('#score').textContent;
  ui.click('#shuffleBtn');
  assert.equal(ui.$('#shuffleCount').textContent, '1');
  assert.match(ui.$('#comboLabel').textContent, /1/);
  assert.equal(ui.$('#score').textContent, beforeShuffleScore);
  assert.deepEqual(ui.boardSnapshot().sort((a, b) => a.id - b.id), before, 'Shuffle preserves all tile values and bonuses');
  ui.click('#shuffleBtn');
  assert.equal(ui.$('#shuffleBtn').disabled, true);
  ui.click('#hintBtn'); ui.click('#hintBtn');
  assert.equal(ui.$('#hintCount').textContent, '0');
  assert.equal(ui.$('#hintBtn').disabled, true);
});

test('finishing during a clear cleans up the board and persists results and the personal best', (t) => {
  const ui = setup(t);
  ui.click('[data-mode="zen"]');
  ui.click('#startBtn');
  ui.clear({ settle: false });
  assert.ok(ui.all('.tile.clearing').length > 0);
  ui.click('#startBtn');
  assert.equal(ui.$('#gameDialog').dataset.type, 'results');
  assert.equal(ui.all('.tile').length, 25);
  assert.equal(ui.all('.tile.clearing').length, 0);
  const saved = ui.storage();
  const records = JSON.parse(saved['sumsurge-records']);
  const history = JSON.parse(saved['sumsurge-history']);
  assert.ok(records.zen > 0);
  assert.equal(history[0].score, records.zen);
  assert.equal(history[0].clears, 1);
  ui.click('#doneBtn');
  ui.advance(500);
  assert.equal(ui.$('#gameDialog').open, false);
  assert.equal(ui.all('.tile.clearing').length, 0, 'A canceled refill cannot modify the ended board');
  const reloaded = setup(t, saved);
  reloaded.click('[data-mode="zen"]');
  assert.equal(Number(reloaded.$('#best').textContent.replace(/\D/g, '')), records.zen);
  assert.equal(reloaded.all('.recent-run').length, 1);
});

test('Daily replay reproduces the starting board and refill after the same route', (t) => {
  const ui = setup(t);
  ui.click('[data-mode="daily"]');
  const initial = ui.boardSnapshot();
  const targets = ui.targets();
  ui.click('#startBtn');
  assert.deepEqual(ui.boardSnapshot(), initial);
  ui.clear();
  const refill = ui.boardSnapshot();
  const nextTargets = ui.targets();
  ui.click('#pauseBtn'); ui.click('#finishBtn'); ui.click('#againBtn');
  assert.deepEqual(ui.boardSnapshot(), initial);
  assert.deepEqual(ui.targets(), targets);
  ui.clear();
  assert.deepEqual(ui.boardSnapshot(), refill);
  assert.deepEqual(ui.targets(), nextTargets);
});

test('a Daily run crossing midnight saves against the day it began', (t) => {
  const ui = setup(t);
  ui.setDate('2026-11-11T23:59:59Z');
  ui.click('[data-mode="daily"]'); ui.click('#startBtn');
  ui.clear(); ui.advance(2000);
  ui.click('#pauseBtn'); ui.click('#finishBtn');
  const keys = Object.keys(JSON.parse(ui.storage()['sumsurge-records']));
  assert.deepEqual(keys, ['daily-2026-11-11']);
});

test('unmuting enables audio before unlocking, and sound preferences survive reload', (t) => {
  const ui = setup(t, { 'sumsurge-muted': 'true' });
  assert.equal(ui.$('#soundBtn').getAttribute('aria-label'), 'Enable sound');
  ui.audioCalls.length = 0;
  ui.click('#soundBtn');
  assert.deepEqual(ui.audioCalls.slice(0, 2), [{ name: 'setEnabled', args: [true] }, { name: 'unlock', args: [] }]);
  assert.equal(ui.$('#soundBtn').getAttribute('aria-pressed'), 'true');
  ui.click('#musicBtn');
  const saved = ui.storage();
  assert.equal(saved['sumsurge-muted'], 'false');
  assert.equal(saved['sumsurge-music'], 'false');
  const reloaded = setup(t, saved);
  assert.equal(reloaded.$('#soundBtn').getAttribute('aria-pressed'), 'true');
  assert.equal(reloaded.$('#musicBtn').getAttribute('aria-pressed'), 'false');
});

test('changing mode during a run requires the in-game finish action and saves that run', (t) => {
  const ui = setup(t);
  ui.click('#startBtn'); ui.clear();
  const clock = ui.$('#clock').textContent;
  ui.click('[data-mode="zen"]');
  assert.equal(ui.$('[data-mode="rush"]').getAttribute('aria-pressed'), 'true');
  assert.equal(ui.$('#gameDialog').open, true);
  ui.advance(10000);
  assert.equal(ui.$('#clock').textContent, clock);
  ui.click('#resumeBtn');
  assert.equal(ui.$('#gameLabel').textContent, 'RUSH CIRCUIT');
  ui.click('[data-mode="zen"]'); ui.click('#switchBtn');
  assert.equal(ui.$('#gameDialog').open, false);
  assert.equal(ui.$('#gameLabel').textContent, 'ZEN CIRCUIT');
  assert.equal(ui.$('#pauseBtn').disabled, true);
  assert.equal(ui.$('#clockLabel').textContent, 'NO PRESSURE');
  assert.ok(JSON.parse(ui.storage()['sumsurge-records']).rush > 0);
  assert.equal(ui.all('.recent-run').length, 1);
});
