window.__ModuleLoader__.load({
  id: "dsh-complete-chime",
  factory: (require) => {
    "use strict";
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let React = null;
    try { React = require("react"); } catch { React = window.React; }
    const { createElement: h, useState, useEffect, useCallback } = React;

    // ── 文案 ───────────────────────────────────────────────────────────────────
    // 这个面板是自足的（不依赖 locale 服务），中英文按 <html lang> 即时切换。
    function zh() {
      try {
        const lang = (document && document.documentElement && document.documentElement.lang) || (navigator && navigator.language) || "";
        return /^zh/i.test(String(lang));
      } catch { return true; }
    }
    const L = (cn, en) => (zh() ? cn : en);

    // ── 设置 ──────────────────────────────────────────────────────────────────
    // 权威副本在宿主侧（桌面宿主每次启动换随机端口，localStorage 的 origin 会
    // 跟着变，只存 localStorage 的话重启后设置就丢了）。localStorage 仅作首屏
    // 快速回填和宿主不可达时的兜底。
    const STORE_KEY = "dsh-complete-chime:v1";
    const API = "/api/dsh-complete-chime/settings";
    const DEFAULTS = {
      enabled: true,
      sound: "chime",
      volume: 70,
      alwaysOn: true,
      announce: false,
      announceText: "任务完成了",
      subagents: false,
      notify: false,
    };
    const SOUND_KEYS = ["chime", "ding", "bell", "music", "alarm", "custom"];
    const MAX_ANNOUNCE = 200;

    function normalize(raw) {
      const merged = { ...DEFAULTS };
      if (raw && typeof raw === "object") {
        for (const key of Object.keys(DEFAULTS)) {
          if (raw[key] !== undefined && typeof raw[key] === typeof DEFAULTS[key]) merged[key] = raw[key];
        }
        if (typeof merged.volume !== "number" || !Number.isFinite(merged.volume)) merged.volume = DEFAULTS.volume;
        merged.volume = Math.max(0, Math.min(100, Math.round(merged.volume)));
        if (!SOUND_KEYS.includes(merged.sound)) merged.sound = DEFAULTS.sound;
        const text = String(merged.announceText || "").trim();
        merged.announceText = text ? text.slice(0, MAX_ANNOUNCE) : DEFAULTS.announceText;
      }
      return merged;
    }

    let settingsCache = null;
    const settingsListeners = new Set();
    function subscribeSettings(listener) {
      settingsListeners.add(listener);
      return () => { settingsListeners.delete(listener); };
    }
    function emitSettings() {
      for (const listener of Array.from(settingsListeners)) {
        try { listener(readSettings()); } catch { /* 单个监听器坏了不影响别人 */ }
      }
    }
    function readLocal() {
      let raw = null;
      try { raw = window.localStorage ? window.localStorage.getItem(STORE_KEY) : null; } catch { raw = null; }
      let parsed = null;
      if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = null; } }
      return normalize(parsed);
    }
    function readSettings() {
      if (settingsCache) return settingsCache;
      settingsCache = readLocal();
      return settingsCache;
    }
    function cacheSettings(next) {
      settingsCache = normalize(next);
      try { if (window.localStorage) window.localStorage.setItem(STORE_KEY, JSON.stringify(settingsCache)); } catch { /* 忽略 */ }
      return settingsCache;
    }
    function writeSettings(next) {
      cacheSettings(next);
      void persistSettings(settingsCache);
      emitSettings();
      return settingsCache;
    }

    // 宿主持久化：拉一次、改了就推（合并 250ms 内的连续改动）。
    let hydrated = false;
    let persistTimer = null;
    async function hydrateSettings() {
      let body = null;
      try {
        const response = await fetch(API, { headers: { accept: "application/json" }, credentials: "same-origin" });
        if (response && response.ok) body = await response.json();
      } catch { body = null; }
      if (!body || body.ok !== true || !body.settings) return false;
      hydrated = true;
      cacheSettings(body.settings);
      emitSettings();
      return true;
    }
    function persistSettings(next) {
      if (!hydrated) return Promise.resolve(false);
      const payload = JSON.stringify(normalize(next));
      return new Promise((resolve) => {
        const send = () => {
          persistTimer = null;
          let request = null;
          try {
            request = fetch(API, { method: "PUT", headers: { "content-type": "application/json" }, body: payload, credentials: "same-origin" });
          } catch { resolve(false); return; }
          Promise.resolve(request).then((response) => resolve(!!(response && response.ok))).catch(() => resolve(false));
        };
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(send, 250);
      });
    }

    // ── 铃声（WebAudio 合成，不需要任何音频文件）─────────────────────────────
    const SOUNDS = {
      chime: {
        label: ["清脆三音", "Bright chime"],
        notes: [[880, 0, 0.34, 0.42], [1318.51, 0.14, 0.36, 0.38], [1760, 0.28, 0.62, 0.34]],
      },
      ding: {
        label: ["叮（单声）", "Single ding"],
        notes: [[1568, 0, 0.9, 0.4], [2349.32, 0.006, 0.7, 0.16]],
      },
      bell: {
        label: ["铃铛（余音）", "Bell (with tail)"],
        notes: [[1046.5, 0, 1.7, 0.32], [2093, 0.004, 1.25, 0.12], [2637, 0.01, 0.9, 0.07]],
      },
      music: {
        label: ["一小段音乐（上行琶音）", "Short melody (arpeggio)"],
        notes: [
          [523.25, 0, 0.34, 0.34], [659.25, 0.18, 0.34, 0.33], [783.99, 0.36, 0.4, 0.32],
          [1046.5, 0.54, 0.5, 0.34], [783.99, 0.8, 0.26, 0.22], [1046.5, 0.96, 0.85, 0.36],
        ],
      },
      alarm: {
        label: ["闹铃（三组提醒）", "Alarm (three rounds)"],
        notes: [
          [988, 0, 0.16, 0.42], [1318.51, 0.2, 0.16, 0.4],
          [988, 0.46, 0.16, 0.42], [1318.51, 0.66, 0.16, 0.4],
          [988, 0.92, 0.16, 0.42], [1318.51, 1.12, 0.36, 0.42],
        ],
      },
      custom: {
        label: ["自定义音乐（本机文件）", "Custom audio (local file)"],
        notes: null,
      },
    };

    let audioCtx = null;
    function getAudioCtx() {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (typeof Ctor !== "function") return null;
      try {
        if (!audioCtx || audioCtx.state === "closed") audioCtx = new Ctor();
        if (audioCtx.state === "suspended") { try { audioCtx.resume(); } catch { /* 等下一个手势 */ } }
        return audioCtx;
      } catch { return null; }
    }
    function tone(ctx, freq, at, dur, gain, type) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.value = freq;
      const level = Math.max(0.0001, gain);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(level, at + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.05, dur));
      osc.connect(env);
      env.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + Math.max(0.06, dur) + 0.03);
      return osc;
    }
    function playPattern(name, volume) {
      const def = SOUNDS[name];
      const ctx = getAudioCtx();
      if (!ctx || !def || !def.notes) return false;
      const master = Math.max(0, Math.min(1, volume == null ? 0.7 : volume)) * 0.75;
      const t0 = ctx.currentTime + 0.03;
      for (const note of def.notes) {
        tone(ctx, note[0], t0 + note[1], note[2], note[3] * master, def.type);
      }
      return true;
    }

    // ── 自定义音乐（IndexedDB 存文件字节，刷新后仍在）────────────────────────
    const DB_NAME = "dsh-complete-chime";
    const DB_STORE = "audio";
    const DB_KEY = "custom";
    const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
    function withDb(mode, run) {
      return new Promise((resolve, reject) => {
        if (typeof window.indexedDB === "undefined") { reject(new Error("indexedDB unavailable")); return; }
        let req;
        try { req = window.indexedDB.open(DB_NAME, 1); } catch (error) { reject(error); return; }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
        };
        req.onerror = () => reject(req.error || new Error("indexedDB open failed"));
        req.onsuccess = () => {
          const db = req.result;
          let tx;
          try { tx = db.transaction(DB_STORE, mode); } catch (error) { db.close(); reject(error); return; }
          const store = tx.objectStore(DB_STORE);
          const done = (value) => { try { db.close(); } catch { /* 已关 */ } resolve(value); };
          const fail = (error) => { try { db.close(); } catch { /* 已关 */ } reject(error); };
          try {
            const result = run(store);
            if (result && typeof result.onsuccess !== "undefined") {
              result.onsuccess = () => done(result.result);
              result.onerror = () => fail(result.error);
            } else {
              tx.oncomplete = () => done(result);
              tx.onerror = () => fail(tx.error);
            }
          } catch (error) { fail(error); }
        };
      });
    }
    function readCustomAudio() { return withDb("readonly", (store) => store.get(DB_KEY)); }
    function writeCustomAudio(record) { return withDb("readwrite", (store) => { store.put(record, DB_KEY); return undefined; }); }
    function clearCustomAudio() { return withDb("readwrite", (store) => { store.delete(DB_KEY); return undefined; }); }

    function playSound(name, volume) {
      const sound = name || "chime";
      if (sound === "custom") {
        return readCustomAudio().then((record) => {
          if (!record || !record.data) return playPattern("chime", volume);
          const ctx = getAudioCtx();
          if (!ctx) return false;
          const bytes = record.data instanceof ArrayBuffer ? record.data.slice(0) : null;
          if (!bytes) return playPattern("chime", volume);
          return ctx.decodeAudioData(bytes).then((buffer) => {
            const src = ctx.createBufferSource();
            const gain = ctx.createGain();
            src.buffer = buffer;
            gain.gain.value = Math.max(0, Math.min(1, volume == null ? 0.7 : volume));
            src.connect(gain);
            gain.connect(ctx.destination);
            src.start();
            return true;
          }).catch(() => playPattern("chime", volume));
        }).catch(() => playPattern("chime", volume));
      }
      return Promise.resolve(playPattern(sound, volume));
    }

    // ── 语音播报 / 系统通知 ───────────────────────────────────────────────────
    function speak(text, volume) {
      try {
        const synth = window.speechSynthesis;
        const Utterance = window.SpeechSynthesisUtterance;
        if (!synth || typeof Utterance !== "function") return false;
        const content = String(text || "").trim();
        if (!content) return false;
        const utterance = new Utterance(content);
        utterance.lang = zh() ? "zh-CN" : "en-US";
        utterance.volume = Math.max(0, Math.min(1, volume == null ? 0.7 : volume));
        utterance.rate = 1;
        try { synth.cancel(); } catch { /* 未在播放 */ }
        synth.speak(utterance);
        return true;
      } catch { return false; }
    }
    function osNotify(title, body) {
      try {
        if (typeof window.Notification !== "function") return false;
        const Notif = window.Notification;
        if (Notif.permission === "granted") { new Notif(title, { body: String(body || "").slice(0, 200) }); return true; }
        if (Notif.permission === "default" && typeof Notif.requestPermission === "function") Notif.requestPermission().catch(() => {});
        return false;
      } catch { return false; }
    }

    // ── 检测「一轮跑完」───────────────────────────────────────────────────────
    function pageHidden() {
      try {
        if (document.visibilityState !== "visible") return true;
        if (typeof document.hasFocus === "function") return !document.hasFocus();
        return false;
      } catch { return false; }
    }
    const runtime = { sessionsAvailable: false, lastAlertAt: 0, watchers: 0 };
    function createWatcher(ctx, onCompletions) {
      let sessions = null;
      try { sessions = ctx.sessions || (typeof ctx.get === "function" ? ctx.get("sessions") : null); } catch { sessions = null; }
      const list = sessions && sessions.list;
      if (!list || typeof list.subscribe !== "function" || typeof list.getSnapshot !== "function") {
        runtime.sessionsAvailable = false;
        return () => {};
      }
      runtime.sessionsAvailable = true;
      runtime.watchers += 1;
      const previous = new Map();
      let primed = false;
      let timer = null;
      let pending = [];
      const flush = () => {
        timer = null;
        const batch = pending;
        pending = [];
        if (batch.length) onCompletions(batch);
      };
      const onChange = () => {
        let snapshot = null;
        try { snapshot = list.getSnapshot(); } catch { return; }
        const byId = (snapshot && snapshot.byId) || {};
        const finished = [];
        for (const id of Object.keys(byId)) {
          const summary = byId[id];
          const running = !!(summary && summary.running === true);
          const before = previous.get(id);
          previous.set(id, running);
          if (primed && before === true && !running) {
            finished.push({ id: id, title: (summary && summary.displayTitle) || "", origin: (summary && summary.origin) || "" });
          }
        }
        for (const id of Array.from(previous.keys())) {
          if (!Object.prototype.hasOwnProperty.call(byId, id)) previous.delete(id);
        }
        if (!primed) { primed = true; return; }
        if (!finished.length) return;
        for (const item of finished) pending.push(item);
        if (timer === null) timer = setTimeout(flush, 400);
      };
      const unsubscribe = list.subscribe(onChange);
      onChange();
      return () => {
        if (timer !== null) { clearTimeout(timer); timer = null; }
        if (typeof unsubscribe === "function") unsubscribe();
        runtime.watchers = Math.max(0, runtime.watchers - 1);
      };
    }

    function handleCompletions(items) {
      const settings = readSettings();
      if (!settings.enabled) return;
      const relevant = items.filter((item) => settings.subagents || item.origin !== "subagent");
      if (!relevant.length) return;
      if (!settings.alwaysOn && !pageHidden()) return;
      const now = Date.now();
      if (now - runtime.lastAlertAt < 900) return;
      runtime.lastAlertAt = now;
      const volume = settings.volume / 100;
      playSound(settings.sound, volume);
      if (settings.announce) speak(settings.announceText, volume);
      if (settings.notify) {
        const title = L("任务完成", "Task finished");
        const body = relevant[0].title || "";
        osNotify(title, body);
      }
    }

    // ── 设置页 ─────────────────────────────────────────────────────────────────
    const CSS = `
      .dcc-wrap{display:flex;flex-direction:column;gap:14px;max-width:780px;font-size:13px;line-height:1.55}
      .dcc-card{border:1px solid var(--dsh-border-color,rgba(127,127,127,.25));border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
      .dcc-card h3{margin:0;font-size:13px;font-weight:600;letter-spacing:.02em}
      .dcc-hint{margin:0;font-size:12px;opacity:.55}
      .dcc-row{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
      .dcc-row .dcc-label{display:flex;flex-direction:column;gap:1px;min-width:0}
      .dcc-row .dcc-label b{font-weight:500;font-size:13px}
      .dcc-row .dcc-label span{font-size:12px;opacity:.55}
      .dcc-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;flex-shrink:0}
      .dcc-controls select,.dcc-controls input[type=text]{background:var(--dsh-input-bg,rgba(127,127,127,.10));color:inherit;border:1px solid var(--dsh-border-color,rgba(127,127,127,.3));border-radius:6px;padding:4px 8px;font:inherit;font-size:12px;min-width:0}
      .dcc-controls input[type=text]{width:180px}
      .dcc-controls input[type=range]{width:150px;accent-color:var(--dsh-accent-color,#4c8dff)}
      .dcc-btn{background:var(--dsh-input-bg,rgba(127,127,127,.10));color:inherit;border:1px solid var(--dsh-border-color,rgba(127,127,127,.3));border-radius:6px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer}
      .dcc-btn:hover{background:rgba(127,127,127,.18)}
      .dcc-btn[disabled]{opacity:.45;cursor:default}
      .dcc-badge{font-size:11px;opacity:.6;border:1px solid var(--dsh-border-color,rgba(127,127,127,.3));border-radius:999px;padding:1px 8px;white-space:nowrap}
      .dcc-msg{font-size:12px;opacity:.65;margin:0}
      .dcc-file{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .dcc-file input[type=file]{display:none}
      .dcc-toggle{display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap}
      .dcc-toggle input{accent-color:var(--dsh-accent-color,#4c8dff)}
    `;

    const SOUND_ORDER = ["chime", "ding", "bell", "music", "alarm", "custom"];

    function Toggle(props) {
      const { checked, onChange, label } = props;
      return h("label", { className: "dcc-toggle" },
        h("input", { type: "checkbox", checked: !!checked, onChange: (event) => onChange(event.target.checked) }),
        h("span", null, label));
    }
    function Row(props) {
      return h("div", { className: "dcc-row" },
        h("div", { className: "dcc-label" }, h("b", null, props.title), props.hint ? h("span", null, props.hint) : null),
        h("div", { className: "dcc-controls" }, props.children));
    }

    function SettingsPanel() {
      const [settings, setSettings] = useState(() => readSettings());
      const [custom, setCustom] = useState(undefined);
      const [message, setMessage] = useState("");
      const [busy, setBusy] = useState(false);
      const fileRef = React.useRef ? React.useRef(null) : { current: null };

      useEffect(() => {
        let alive = true;
        hydrateSettings()
          .then((ok) => { if (alive && ok) setSettings(readSettings()); })
          .catch(() => { /* 宿主路由不可达时继续用本地缓存 */ });
        const off = subscribeSettings((next) => { if (alive) setSettings(next); });
        return () => { alive = false; off(); };
      }, []);

      useEffect(() => {
        let alive = true;
        readCustomAudio()
          .then((record) => { if (alive) setCustom(record && record.data ? { name: record.name || "audio", size: record.size || 0 } : null); })
          .catch(() => { if (alive) setCustom(null); });
        return () => { alive = false; };
      }, []);

      const patch = useCallback((next) => {
        setSettings((prev) => writeSettings({ ...prev, ...next }));
      }, []);
      const preview = useCallback(() => {
        const current = readSettings();
        playSound(current.sound, current.volume / 100);
        if (current.announce) speak(current.announceText, current.volume / 100);
      }, []);
      const onPick = useCallback(async (event) => {
        const input = event.target;
        const file = input && input.files && input.files[0];
        if (!file) return;
        if (file.size > MAX_AUDIO_BYTES) {
          setMessage(L("文件太大，上限 12 MB。", "File too large — 12 MB maximum."));
          try { input.value = ""; } catch { /* 忽略 */ }
          return;
        }
        setBusy(true);
        try {
          const data = await file.arrayBuffer();
          await writeCustomAudio({ name: file.name, size: file.size, type: file.type || "", data: data, savedAt: Date.now() });
          setCustom({ name: file.name, size: file.size });
          patch({ sound: "custom" });
          setMessage(L("已保存。点「试听」听听看。", "Saved. Click Preview to hear it."));
        } catch (error) {
          setMessage(L("保存失败：", "Could not save: ") + String((error && error.message) || error));
        } finally {
          setBusy(false);
          try { input.value = ""; } catch { /* 忽略 */ }
        }
      }, [patch]);
      const onClear = useCallback(async () => {
        try { await clearCustomAudio(); } catch { /* 本来就没有 */ }
        setCustom(null);
        if (readSettings().sound === "custom") patch({ sound: "chime" });
        setMessage(L("已清除自定义音乐。", "Custom audio cleared."));
      }, [patch]);

      const status = runtime.sessionsAvailable
        ? L("已连上会话列表，等待一轮任务跑完。", "Connected to the session list; waiting for a turn to finish.")
        : L("没连上会话列表——设置页仍可用，但不会自动响铃。", "Session list not connected — settings still work, but the chime will not fire by itself.");

      return h("div", { className: "dcc-wrap" },
        h("div", { className: "dcc-card" },
          h("h3", null, L("完成提示音", "Completion chime")),
          h("p", { className: "dcc-hint" }, L(
            "一轮对话或任务真正跑完时，响一声铃（或放一小段音乐），这样你可以去忙别的，不用一直盯着屏幕。",
            "Play a chime (or a short melody) when a turn or task actually finishes, so you can walk away instead of watching the screen."
          )),
          h(Row, { title: L("启用", "Enabled"), hint: status },
            h(Toggle, { checked: settings.enabled, onChange: (value) => patch({ enabled: value }), label: settings.enabled ? L("开", "On") : L("关", "Off") })
          )
        ),
        h("div", { className: "dcc-card" },
          h("h3", null, L("声音", "Sound")),
          h(Row, { title: L("铃声", "Tone"), hint: L("六种内置音色，最后一个用你上传的音乐。", "Six built-in tones; the last one plays your own audio.") },
            h("select", {
              value: settings.sound,
              onChange: (event) => patch({ sound: event.target.value }),
            }, SOUND_ORDER.map((key) => {
              const label = SOUNDS[key].label[zh() ? 0 : 1];
              const suffix = key === "custom" && custom ? " · " + custom.name : "";
              return h("option", { key: key, value: key }, label + suffix);
            })),
            h("button", { className: "dcc-btn", onClick: preview, type: "button" }, L("试听", "Preview"))
          ),
          h(Row, { title: L("音量", "Volume"), hint: L("0 – 100", "0 – 100") },
            h("input", {
              type: "range", min: 0, max: 100, step: 5, value: settings.volume,
              onChange: (event) => patch({ volume: Number(event.target.value) }),
            }),
            h("span", { className: "dcc-badge" }, String(settings.volume) + "%")
          ),
          h(Row, { title: L("只在窗口不在前台时响", "Only when the window is in the background"), hint: L("推荐。你正看着屏幕时不打扰。", "Recommended: no sound while you are actually looking at it.") },
            h(Toggle, { checked: !settings.alwaysOn, onChange: (value) => patch({ alwaysOn: !value }), label: !settings.alwaysOn ? L("开", "On") : L("关", "Off") })
          )
        ),
        h("div", { className: "dcc-card" },
          h("h3", null, L("提醒方式", "Alerts")),
          h(Row, { title: L("语音播报", "Spoken announcement"), hint: L("系统 TTS 念一句，比铃声更醒目。", "The system voice says a short line — harder to miss than a chime.") },
            h(Toggle, { checked: settings.announce, onChange: (value) => patch({ announce: value }), label: settings.announce ? L("开", "On") : L("关", "Off") }),
            h("input", {
              type: "text", value: settings.announceText, disabled: !settings.announce,
              title: L("播报内容", "Spoken text"),
              onChange: (event) => patch({ announceText: event.target.value }),
            }),
            h("button", {
              className: "dcc-btn", type: "button", disabled: !settings.announce,
              onClick: () => speak(readSettings().announceText, readSettings().volume / 100),
            }, L("念一遍", "Say it"))
          ),
          h(Row, { title: L("系统通知", "System notification"), hint: L("首次开启时系统会问一次权限。", "The OS may ask for permission the first time.") },
            h(Toggle, { checked: settings.notify, onChange: (value) => patch({ notify: value }), label: settings.notify ? L("开", "On") : L("关", "Off") })
          ),
          h(Row, { title: L("子代理完成也提醒", "Also alert for subagents"), hint: L("默认只提醒主任务；开了会多响。", "Default: main turns only; on means more chimes.") },
            h(Toggle, { checked: settings.subagents, onChange: (value) => patch({ subagents: value }), label: settings.subagents ? L("开", "On") : L("关", "Off") })
          )
        ),
        h("div", { className: "dcc-card" },
          h("h3", null, L("自定义音乐", "Custom audio")),
          h(Row, { title: L("音频文件", "Audio file"), hint: L("支持 mp3 / wav / ogg / m4a，上限 12 MB。存在本机浏览器数据库里，随插件一起用。", "mp3 / wav / ogg / m4a, up to 12 MB, kept in the local browser database.") },
            h("div", { className: "dcc-file" },
              h("span", { className: "dcc-badge" }, custom ? custom.name + " · " + formatBytes(custom.size) : L("未选择", "None")),
              h("button", { className: "dcc-btn", type: "button", disabled: busy, onClick: () => { try { fileRef.current && fileRef.current.click(); } catch { /* 忽略 */ } } }, busy ? L("读取中…", "Reading…") : L("选择文件", "Choose file")),
              custom ? h("button", { className: "dcc-btn", type: "button", onClick: onClear }, L("清除", "Clear")) : null,
              h("input", { ref: fileRef, type: "file", accept: "audio/*", onChange: onPick })
            )
          ),
          message ? h("p", { className: "dcc-msg" }, message) : null
        ),
        h("p", { className: "dcc-hint" }, L(
          "所有设置立即生效，只存在本机，不会上传。",
          "Settings apply immediately and stay on this machine."
        ))
      );
    }

    function formatBytes(size) {
      const n = Number(size) || 0;
      if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
      if (n >= 1024) return Math.round(n / 1024) + " KB";
      return n + " B";
    }

    // ── 注册 ───────────────────────────────────────────────────────────────────
    function apply(ctx) {
      // 先把宿主侧的设置拉下来，这样即使从不打开设置页，watcher 用的也是上次
      // 保存的音量/音色；拉不到就退回 localStorage。
      try { void hydrateSettings(); } catch { /* 忽略 */ }
      try {
        const style = document.createElement("style");
        style.setAttribute("data-plugin", "dsh-complete-chime");
        style.textContent = CSS;
        document.head.appendChild(style);
        if (typeof ctx.effect === "function") {
          ctx.effect(() => () => { try { style.remove(); } catch { /* 已移除 */ } }, "complete-chime: styles");
        }
      } catch { /* 无 DOM 时（单测）跳过样式 */ }

      // 浏览器自动播放策略要求一次用户手势才能出声；在第一次点击/按键时把
      // AudioContext 唤醒，之后跑完的铃声就不会被静音策略吃掉。
      const unlock = () => { getAudioCtx(); };
      try {
        document.addEventListener("pointerdown", unlock, { capture: true, once: true });
        document.addEventListener("keydown", unlock, { capture: true, once: true });
      } catch { /* 无 DOM */ }
      if (typeof ctx.effect === "function") {
        ctx.effect(() => () => {
          try {
            document.removeEventListener("pointerdown", unlock, true);
            document.removeEventListener("keydown", unlock, true);
          } catch { /* 忽略 */ }
        }, "complete-chime: audio unlock");
        ctx.effect(() => createWatcher(ctx, handleCompletions), "complete-chime: session watcher");
      } else {
        createWatcher(ctx, handleCompletions);
      }

      try {
        ctx.slots.inject("settings.section", () => ctx.slots.register({
          name: "settings.section",
          id: "complete-chime",
          order: 62,
          label: () => L("完成提示音", "Completion chime"),
        }, () => h(SettingsPanel, null)));
      } catch (error) {
        try { ctx.logger && ctx.logger.warn("complete-chime: settings section registration failed"); } catch { /* 忽略 */ }
      }
    }

    exports.apply = apply;
    exports.inject = ["slots", "sessions"];
    exports.name = "dsh-complete-chime";
    exports.__test = {
      DEFAULTS: DEFAULTS,
      SOUNDS: SOUNDS,
      SOUND_ORDER: SOUND_ORDER,
      readSettings: readSettings,
      writeSettings: writeSettings,
      normalize: normalize,
      hydrateSettings: hydrateSettings,
      persistSettings: persistSettings,
      subscribeSettings: subscribeSettings,
      API: API,
      resetSettingsCache: () => { settingsCache = null; hydrated = false; },
      createWatcher: createWatcher,
      handleCompletions: handleCompletions,
      pageHidden: pageHidden,
      playSound: playSound,
      playPattern: playPattern,
      speak: speak,
      runtime: runtime,
      SettingsPanel: SettingsPanel,
      formatBytes: formatBytes,
      L: L,
    };
    return module.exports;
  },
});
