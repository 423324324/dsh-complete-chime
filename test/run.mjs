#!/usr/bin/env node
/**
 * Headless test for dsh-complete-chime's client bundle.
 *
 * Loads lib/client.js in Node with a fake browser surface, captures the module
 * factory that `window.__ModuleLoader__.load` receives, and exercises the real
 * logic: settings persistence, the sessions watcher (running true -> false),
 * the focus rule, subagent filtering, debounce, and the settings-panel
 * registration.
 *
 * Usage: node test/harness.mjs
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = join(here, "..", "lib", "client.js");

let failures = 0;
let checks = 0;
function check(name, condition, detail) {
  checks += 1;
  if (condition) {
    console.log("  ok   " + name);
  } else {
    failures += 1;
    console.log("  FAIL " + name + (detail === undefined ? "" : " - " + String(detail)));
  }
}
function equal(name, actual, expected) {
  check(name, actual === expected, "expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --------------------------------------------------------------- fake browser
const storage = new Map();
let oscCount = 0;
let startedSources = 0;
class FakeAudioContext {
  constructor() {
    this.state = "running";
    this.currentTime = 0;
    this.destination = { name: "destination" };
    this.sampleRate = 48000;
  }
  resume() { this.state = "running"; return Promise.resolve(); }
  createOscillator() {
    oscCount += 1;
    return {
      type: "sine",
      frequency: { value: 0 },
      connect() {},
      start() { startedSources += 1; },
      stop() {},
    };
  }
  createGain() {
    return {
      gain: {
        value: 0,
        setValueAtTime() {},
        linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {},
      },
      connect() {},
    };
  }
  createBufferSource() {
    return { buffer: null, connect() {}, start() {}, stop() {} };
  }
  decodeAudioData() { return Promise.resolve({ duration: 1 }); }
}

let spoken = [];
const fakeSpeech = {
  cancel() {},
  speak(utterance) { spoken.push(utterance.text); },
};
class FakeUtterance {
  constructor(text) { this.text = text; this.lang = ""; this.volume = 1; this.rate = 1; }
}

const defineGlobal = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
const fakeDocument = {
  visibilityState: "hidden",
  documentElement: { lang: "zh-CN" },
  head: { appendChild() {} },
  createElement() { return { setAttribute() {}, remove() {}, style: {}, textContent: "" }; },
  addEventListener() {},
  removeEventListener() {},
  hasFocus() { return false; },
};

let loaded = null;
defineGlobal("window", {
  __ModuleLoader__: {
    load(definition) { loaded = definition; },
  },
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  },
  AudioContext: FakeAudioContext,
  speechSynthesis: fakeSpeech,
  SpeechSynthesisUtterance: FakeUtterance,
  Notification: undefined,
  indexedDB: undefined,
});
defineGlobal("document", fakeDocument);
defineGlobal("navigator", { language: "zh-CN" });

// The bundle is a plain script: it only touches window/document/navigator.
await import(pathToFileURL(clientPath).href);

check("bundle registered itself with the shell module loader", loaded !== null && loaded.id === "dsh-complete-chime");

const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial }),
};
const fakeRequire = (name) => {
  if (name === "react") return fakeReact;
  throw new Error("unexpected require: " + name);
};

const api = loaded.factory(fakeRequire);
const T = api.__test;

// ------------------------------------------------- 1. settings persistence
console.log("\nsettings");
equal("defaults: enabled", T.readSettings().enabled, true);
equal("defaults: sound", T.readSettings().sound, "chime");
equal("defaults: volume", T.readSettings().volume, 70);
T.writeSettings({ ...T.DEFAULTS, sound: "music", volume: 150 });
T.resetSettingsCache();
equal("write/read round-trip", T.readSettings().sound, "music");
equal("volume clamped to 100", T.readSettings().volume, 100);
storage.set("dsh-complete-chime:v1", "{not json");
T.resetSettingsCache();
equal("corrupt storage falls back to defaults", T.readSettings().sound, "chime");
T.writeSettings({ ...T.DEFAULTS });
T.resetSettingsCache();

// ---------------------------------------- 1b. host-side persistence round trip
console.log("\nhost settings");
let puts = [];
let hostSettings = { ...T.DEFAULTS, sound: "bell", volume: 33, announceText: "build done" };
defineGlobal("fetch", (url, init) => {
  if (!init || !init.method) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, settings: hostSettings }) });
  }
  puts.push(JSON.parse(init.body));
  return Promise.resolve({ ok: true });
});
let heard = [];
T.subscribeSettings((next) => heard.push(next.sound));
const hydratedOk = await T.hydrateSettings();
equal("hydrate succeeds", hydratedOk, true);
equal("host settings win over local cache: sound", T.readSettings().sound, "bell");
equal("host settings win over local cache: volume", T.readSettings().volume, 33);
check("hydrate notifies subscribers", heard.includes("bell"), JSON.stringify(heard));
equal("host labels survive", T.readSettings().announceText, "build done");

T.writeSettings({ ...T.readSettings(), sound: "music" });
await sleep(400);
check("change pushed to host", puts.length === 1, JSON.stringify(puts));
equal("pushed payload carries the new sound", puts[0] && puts[0].sound, "music");
equal("pushed payload is sanitized", puts[0] && puts[0].volume, 33);

equal("normalize rejects unknown sound", T.normalize({ sound: "nope" }).sound, "chime");
equal("normalize rounds volume", T.normalize({ volume: 42.6 }).volume, 43);
equal("normalize caps announce text", T.normalize({ announceText: "x".repeat(500) }).announceText.length, 200);
hostSettings = { ...T.DEFAULTS };
await T.hydrateSettings();
T.writeSettings({ ...T.DEFAULTS });
T.resetSettingsCache();

// --------------------------------------- 2. session watcher: running -> idle
console.log("\nwatcher");
const snapshot = { byId: {} };
const subscribers = [];
const fakeList = {
  getSnapshot: () => snapshot,
  subscribe(cb) { subscribers.push(cb); return () => { const at = subscribers.indexOf(cb); if (at >= 0) subscribers.splice(at, 1); }; },
};
const registered = [];
const effects = [];
const fakeCtx = {
  sessions: { list: fakeList },
  get(name) { return name === "sessions" ? { list: fakeList } : undefined; },
  effect(fn, label) { const dispose = fn(); effects.push({ label, dispose }); },
  slots: {
    inject(name, register) { return register(); },
    register(spec, component) { registered.push({ spec, component }); return () => {}; },
  },
  logger: { warn() {} },
};

T.writeSettings({ ...T.DEFAULTS, alwaysOn: true, volume: 50 });
T.resetSettingsCache();
api.apply(fakeCtx);

const section = registered.find((entry) => entry.spec.name === "settings.section");
check("settings section registered", section !== undefined);
equal("settings section id", section && section.spec.id, "complete-chime");
equal("settings section order", section && section.spec.order, 62);
equal("settings section label is a string", typeof (section && section.spec.label()), "string");
check("watcher is connected", T.runtime.sessionsAvailable === true, String(T.runtime.sessionsAvailable));

const fire = () => { for (const cb of [...subscribers]) cb(); };
snapshot.byId = { s1: { id: "s1", running: true, displayTitle: "project A" } };
fire(); // primes
equal("no chime while running", oscCount, 0);
snapshot.byId = { s1: { id: "s1", running: false, displayTitle: "project A" } };
fire();
check("waits for the debounce window", oscCount === 0, String(oscCount));
await sleep(500);
equal("chime plays after the turn ends", oscCount, 3);

// debounce: a second completion right after the first stays silent
T.runtime.lastAlertAt = 0;
oscCount = 0;
snapshot.byId = { s1: { id: "s1", running: true }, s2: { id: "s2", running: true } };
fire();
snapshot.byId = { s1: { id: "s1", running: false }, s2: { id: "s2", running: false } };
fire();
await sleep(500);
equal("two sessions finishing together ring once", oscCount, 3);

// ---------------------------------------------------------------- 3. filters
console.log("\nfilters");
T.runtime.lastAlertAt = 0;
oscCount = 0;
snapshot.byId = { sub: { id: "sub", running: true, origin: "subagent" } };
fire();
snapshot.byId = { sub: { id: "sub", running: false, origin: "subagent" } };
fire();
await sleep(500);
equal("subagent completion silent by default", oscCount, 0);

T.writeSettings({ ...T.DEFAULTS, alwaysOn: true, subagents: true });
T.resetSettingsCache();
T.runtime.lastAlertAt = 0;
oscCount = 0;
snapshot.byId = { sub: { id: "sub", running: true, origin: "subagent" } };
fire();
snapshot.byId = { sub: { id: "sub", running: false, origin: "subagent" } };
fire();
await sleep(500);
equal("subagent completion rings when opted in", oscCount, 3);

// focus rule: with "only when the window is in the background" on (alwaysOn:false)
// the chime is suppressed while the page is focused
equal("default settings ring even when focused", T.DEFAULTS.alwaysOn, true);
T.writeSettings({ ...T.DEFAULTS, alwaysOn: false });
T.resetSettingsCache();
T.runtime.lastAlertAt = 0;
oscCount = 0;
fakeDocument.visibilityState = "visible";
fakeDocument.hasFocus = () => true;
snapshot.byId = { s1: { id: "s1", running: true } };
fire();
snapshot.byId = { s1: { id: "s1", running: false } };
fire();
await sleep(500);
equal("no chime while the window is focused", oscCount, 0);

T.runtime.lastAlertAt = 0;
oscCount = 0;
fakeDocument.visibilityState = "visible";
fakeDocument.hasFocus = () => false;
snapshot.byId = { s1: { id: "s1", running: true } };
fire();
snapshot.byId = { s1: { id: "s1", running: false } };
fire();
await sleep(500);
equal("chime while the window is unfocused", oscCount, 3);

// master switch
T.writeSettings({ ...T.DEFAULTS, enabled: false, alwaysOn: true });
T.resetSettingsCache();
T.runtime.lastAlertAt = 0;
oscCount = 0;
snapshot.byId = { s1: { id: "s1", running: true } };
fire();
snapshot.byId = { s1: { id: "s1", running: false } };
fire();
await sleep(500);
equal("disabled plugin stays silent", oscCount, 0);

// --------------------------------------------- 4. sound + speech paths
console.log("\nsounds");
T.writeSettings({ ...T.DEFAULTS, alwaysOn: true, sound: "music", announce: true, announceText: "任务完成了" });
T.resetSettingsCache();
T.runtime.lastAlertAt = 0;
oscCount = 0;
spoken = [];
snapshot.byId = { s1: { id: "s1", running: true } };
fire();
snapshot.byId = { s1: { id: "s1", running: false } };
fire();
await sleep(500);
equal("music melody uses six notes", oscCount, 6);
check("spoken announcement fired", spoken.length === 1 && spoken[0] === "任务完成了", JSON.stringify(spoken));

for (const name of T.SOUND_ORDER) {
  if (name === "custom") continue;
  equal('sound "' + name + '" has notes', Array.isArray(T.SOUNDS[name].notes), true);
  check('sound "' + name + '" has a label', Array.isArray(T.SOUNDS[name].label) && T.SOUNDS[name].label.length === 2);
}
const customFallback = await T.playSound("custom", 0.5);
check("custom audio falls back to the chime without indexedDB", customFallback === true);

// cleanup path
for (const entry of effects) { if (typeof entry.dispose === "function") entry.dispose(); }
equal("watcher unsubscribed on dispose", subscribers.length, 0);
equal("runtime watcher count back to zero", T.runtime.watchers, 0);

console.log("\n" + (failures === 0 ? "PASS" : "FAIL") + ": " + (checks - failures) + "/" + checks + " checks ok");
process.exit(failures === 0 ? 0 : 1);
