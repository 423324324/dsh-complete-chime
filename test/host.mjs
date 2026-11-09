#!/usr/bin/env node
/**
 * Headless test for the host half: `sanitize` and the settings route handler.
 *
 * `apply(ctx)` is exercised with a fake webServer so the loopback / origin /
 * method / body fences get real requests (fake req/res objects).
 *
 * Usage: node test/host.mjs
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const home = await mkdtemp(join(tmpdir(), "dcc-host-"));
process.env.DSH_HOME = home;

const host = await import(pathToFileURL(join(here, "..", "lib", "index.js")).href);
const { sanitize, apply, name } = host;

let failures = 0;
let checks = 0;
function check(label, condition, detail) {
  checks += 1;
  console.log((condition ? "  ok   " : "  FAIL ") + label + (condition || detail === undefined ? "" : " - " + String(detail)));
  if (!condition) failures += 1;
}
function equal(label, actual, expected) {
  check(label, actual === expected, "expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------- sanitize
equal("name", name, "dsh-complete-chime");
equal("unknown sound rejected", sanitize({ sound: "nope" }).sound, "chime");
equal("volume clamped low", sanitize({ volume: -20 }).volume, 0);
equal("volume clamped high", sanitize({ volume: 999 }).volume, 100);
equal("volume rounded", sanitize({ volume: 42.6 }).volume, 43);
equal("non-boolean dropped", sanitize({ enabled: "yes" }).enabled, true);
equal("blank announce text replaced", sanitize({ announceText: "   " }).announceText, "任务完成了");
equal("announce text capped", sanitize({ announceText: "x".repeat(500) }).announceText.length, 200);
equal("garbage input yields defaults", sanitize(null).sound, "chime");
equal("unknown keys dropped", sanitize({ evil: true }).evil, undefined);

// ------------------------------------------------------------- route plumbing
let registered = null;
const effects = [];
const ctx = {
  webServer: {
    host: "127.0.0.1:54509",
    register(spec) { registered = spec; return () => { registered = null; }; },
  },
  effect(fn, label) { effects.push({ label, dispose: fn() }); },
};
apply(ctx);
check("route registered", registered !== null && registered.path === "/api/dsh-complete-chime/settings", JSON.stringify(registered));
equal("route kind", registered && registered.kind, "exact");

function request(handler, { method = "GET", body = null, origin, remote = "127.0.0.1", host = "127.0.0.1:54509", site } = {}) {
  return new Promise((resolve) => {
    const listeners = {};
    const req = {
      method,
      socket: { remoteAddress: remote },
      headers: { host, ...(origin ? { origin } : {}), ...(site ? { "sec-fetch-site": site } : {}) },
      on(event, cb) { listeners[event] = cb; },
      destroy() {},
    };
    const response = { status: 0, headers: null, body: "" };
    const res = {
      writeHead(status, headers) { response.status = status; response.headers = headers; },
      end(text) { response.body = text || ""; resolve(response); },
    };
    const promise = handler(req, res);
    if (body !== null) listeners.data && listeners.data(Buffer.from(body));
    listeners.end && listeners.end();
    Promise.resolve(promise).catch((error) => resolve({ status: 0, body: String(error) }));
  });
}

let response = await request(registered.handler);
equal("GET fresh file returns defaults", JSON.parse(response.body).settings.sound, "chime");

const putBody = JSON.stringify({ sound: "music", volume: 55, alwaysOn: true, announce: true, announceText: "搞定" });
response = await request(registered.handler, { method: "PUT", body: putBody });
const putJson = JSON.parse(response.body);
equal("PUT status", response.status, 200);
equal("PUT echoes settings", putJson.settings.sound, "music");
equal("PUT volume", putJson.settings.volume, 55);

const stored = JSON.parse(await readFile(join(home, "dsh-complete-chime", "settings.json"), "utf8"));
equal("settings file written", stored.sound, "music");
equal("settings file keeps booleans", stored.alwaysOn, true);

response = await request(registered.handler);
equal("GET after PUT returns saved", JSON.parse(response.body).settings.volume, 55);

response = await request(registered.handler, { method: "DELETE" });
equal("unsupported method rejected", response.status, 405);

response = await request(registered.handler, { remote: "10.0.0.7" });
equal("non-loopback rejected", response.status, 403);

response = await request(registered.handler, { origin: "http://evil.example" });
equal("foreign origin rejected", response.status, 403);

response = await request(registered.handler, { origin: "http://127.0.0.1:54509" });
equal("same-origin allowed", response.status, 200);

response = await request(registered.handler, { site: "cross-site" });
equal("cross-site fetch rejected", response.status, 403);

response = await request(registered.handler, { method: "PUT", body: "{broken" });
equal("broken JSON rejected", response.status, 400);

response = await request(registered.handler, { method: "PUT", body: "[1,2]" });
equal("non-object body rejected", response.status, 400);

// a corrupt file must not break the handler
await rm(join(home, "dsh-complete-chime", "settings.json"));
const { writeFile } = await import("node:fs/promises");
await writeFile(join(home, "dsh-complete-chime", "settings.json"), "{oops");
response = await request(registered.handler);
equal("corrupt file falls back to defaults", JSON.parse(response.body).settings.sound, "chime");

for (const entry of effects) { if (typeof entry.dispose === "function") entry.dispose(); }
check("route unregisters on dispose", registered === null);

await rm(home, { recursive: true, force: true });
await sleep(10);
console.log("\n" + (failures === 0 ? "PASS" : "FAIL") + ": " + (checks - failures) + "/" + checks + " checks ok");
process.exit(failures === 0 ? 0 : 1);
