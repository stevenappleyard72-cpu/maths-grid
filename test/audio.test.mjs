import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const audioSource = await readFile(new URL('../src/audio.js', import.meta.url), 'utf8');
let instance = 0;

async function setup(t, { supported = true, rejectResume = false } = {}) {
  const rig = { contexts: [], sources: [], nodes: [], intervals: new Map(), nextInterval: 0 };
  const parameter = () => ({
    value: 0,
    events: [],
    setValueAtTime(value, time) { this.events.push({ value, time }); },
    linearRampToValueAtTime(value, time) { this.events.push({ value, time }); },
    exponentialRampToValueAtTime(value, time) { this.events.push({ value, time }); },
    cancelScheduledValues(time) { this.cancelledAt = time; },
    setTargetAtTime(value, time) { this.events.push({ value, time }); },
  });
  const node = () => {
    const item = {
      disconnected: false,
      connect() {},
      disconnect() { this.disconnected = true; },
      gain: parameter(), frequency: parameter(), threshold: parameter(),
      knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter(),
    };
    rig.nodes.push(item);
    return item;
  };
  const source = () => {
    const item = {
      ...node(),
      start(time) { this.startTime = time; },
      stop(time) { this.stopTime = time; this.stopCalls = (this.stopCalls || 0) + 1; },
      finish() { this.onended?.(); },
    };
    rig.sources.push(item);
    return item;
  };
  class MockAudioContext {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 1;
      this.sampleRate = 8000;
      this.destination = node();
      rig.contexts.push(this);
    }
    async resume() {
      if (rejectResume) throw new Error('Audio was blocked');
      this.state = 'running';
    }
    createGain() { return node(); }
    createDynamicsCompressor() { return node(); }
    createBiquadFilter() { return node(); }
    createOscillator() { return source(); }
    createBufferSource() { return source(); }
    createBuffer(channels, length) {
      assert.ok(channels > 0 && length > 0);
      return { getChannelData() { return new Float32Array(length); } };
    }
  }
  t.mock.method(globalThis, 'setInterval', (callback) => {
    const id = ++rig.nextInterval;
    rig.intervals.set(id, callback);
    return id;
  });
  t.mock.method(globalThis, 'clearInterval', (id) => rig.intervals.delete(id));
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const originalWebkit = Object.getOwnPropertyDescriptor(globalThis, 'webkitAudioContext');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: supported ? MockAudioContext : undefined });
  Object.defineProperty(globalThis, 'webkitAudioContext', { configurable: true, value: undefined });
  const url = `data:text/javascript;base64,${Buffer.from(audioSource).toString('base64')}#audio-test-${++instance}`;
  const { sound } = await import(url);
  t.after(() => {
    sound.stop();
    if (originalAudio) Object.defineProperty(globalThis, 'AudioContext', originalAudio);
    else delete globalThis.AudioContext;
    if (originalWebkit) Object.defineProperty(globalThis, 'webkitAudioContext', originalWebkit);
    else delete globalThis.webkitAudioContext;
  });
  rig.sound = sound;
  return rig;
}

test('audio stays dormant until explicitly unlocked by a user gesture', async (t) => {
  const { sound, contexts, sources, intervals } = await setup(t);
  sound.start('rush');
  sound.play('select', { step: 0 });
  assert.equal(contexts.length, 0);
  assert.equal(sources.length, 0);
  assert.equal(intervals.size, 0);
  assert.equal(await sound.unlock(), true);
  assert.equal(contexts.length, 1);
  assert.equal(intervals.size, 1);
  assert.ok(sources.length > 0);
});

test('unsupported or blocked browser audio never prevents play', async (t) => {
  await t.test('unsupported AudioContext', async (subtest) => {
    const { sound, intervals } = await setup(subtest, { supported: false });
    sound.start();
    assert.equal(await sound.unlock(), false);
    assert.doesNotThrow(() => sound.play('clear'));
    assert.equal(intervals.size, 0);
  });
  await t.test('browser rejects resume', async (subtest) => {
    const { sound, sources, intervals } = await setup(subtest, { rejectResume: true });
    sound.start();
    assert.equal(await sound.unlock(), false);
    sound.play('surge');
    assert.equal(sources.length, 0);
    assert.equal(intervals.size, 0);
  });
});

test('starting repeatedly creates one scheduler and delayed ticks do not backfill old music', async (t) => {
  const { sound, contexts, sources, intervals } = await setup(t);
  await sound.unlock();
  sound.start('rush');
  sound.start('rush');
  await sound.unlock();
  assert.equal(intervals.size, 1);
  const tick = [...intervals.values()][0];
  const before = sources.length;
  contexts[0].currentTime += 600;
  tick();
  assert.ok(sources.length - before < 10, 'an inactive tab must not queue ten minutes of notes');
  assert.ok(sound.nextBeat > contexts[0].currentTime);
  contexts[0].state = 'suspended';
  tick();
  assert.equal(intervals.size, 0, 'suspended audio stops its background timer');
});

test('pause cancels the scheduler and releases every scheduled voice promptly', async (t) => {
  const { sound, contexts, sources, intervals } = await setup(t);
  await sound.unlock();
  sound.start('zen');
  sound.play('surge');
  assert.ok(sources.some((item) => item.startTime > contexts[0].currentTime));
  sound.stop();
  assert.equal(intervals.size, 0);
  assert.equal(sound.wanted, false);
  for (const item of sources) {
    assert.equal(item.stopTime, contexts[0].currentTime + 0.025);
    assert.ok(item.stopCalls >= 2, 'the original scheduled stop is replaced by an immediate release');
  }
  sound.start('zen');
  assert.equal(intervals.size, 1, 'a later run or resume can restart the groove');
});

test('master mute stops everything; music mute keeps game feedback available', async (t) => {
  const { sound, sources, intervals } = await setup(t);
  await sound.unlock();
  sound.start();
  sound.setEnabled(false);
  assert.equal(intervals.size, 0);
  const mutedCount = sources.length;
  sound.play('clear');
  assert.equal(sources.length, mutedCount);
  sound.setEnabled(true);
  assert.equal(intervals.size, 1);
  sound.setMusicEnabled(false);
  assert.equal(intervals.size, 0);
  const effectsCount = sources.length;
  sound.play('clear');
  assert.ok(sources.length > effectsCount);
  sound.setMusicEnabled(true);
  assert.equal(intervals.size, 1);
});

test('all game cues schedule finite, bounded notes and clean up when they end', async (t) => {
  const { sound, sources } = await setup(t);
  await sound.unlock();
  for (const type of ['select', 'undo', 'invalid', 'clear', 'surge', 'countdown', 'end', 'ui', 'shuffle', 'hint']) {
    const before = sources.length;
    sound.play(type, { step: 2, combo: 3, length: 5 });
    assert.ok(sources.length > before, `${type} creates an audible cue`);
  }
  for (const item of sources) {
    assert.ok(Number.isFinite(item.startTime));
    assert.ok(Number.isFinite(item.stopTime));
    assert.ok(item.stopTime > item.startTime);
    assert.ok(item.stopTime - item.startTime < 4);
    assert.ok(item.frequency.events.every(({ value }) => Number.isFinite(value) && value > 0));
    item.finish();
    assert.equal(item.disconnected, true);
  }
  assert.equal(sound.voices.size, 0, 'completed sources do not accumulate in memory');
});

test('rapid pointer events are throttled and intensity is bounded', async (t) => {
  const { sound, sources, contexts } = await setup(t);
  await sound.unlock();
  sound.play('select', { step: 0 });
  const firstCount = sources.length;
  sound.play('select', { step: 1 });
  assert.equal(sources.length, firstCount);
  contexts[0].currentTime += 0.03;
  sound.play('select', { step: 1 });
  assert.ok(sources.length > firstCount);
  sound.setIntensity(-1);
  assert.equal(sound.intensity, 0);
  sound.setIntensity(2);
  assert.equal(sound.intensity, 1);
  sound.setIntensity(Number.NaN);
  assert.equal(sound.intensity, 0);
});
