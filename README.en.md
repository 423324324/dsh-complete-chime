# dsh-complete-chime

A DeepSeek Harness (DSH) plugin that plays a chime or a short melody when an agent turn **really finishes**, so you can walk away instead of watching the screen.

Zero dependencies, zero build step, no network requests: the sounds are synthesized live with Web Audio, and the settings live on the host.

## When it rings

- When a session's `running` flag goes from `true` to `false` — i.e. one turn actually finished. An interrupted turn stays silent.
- Subagent sessions are ignored by default (toggle in Settings).
- By default it only rings while the window is **not** in the foreground. Turn that off to hear it every time.
- Several sessions finishing together ring only once (900 ms cooldown).

## Settings

**Settings → Completion chime** (same list as other plugins' settings pages).

| Setting | Description |
| --- | --- |
| Enabled | Master switch |
| Sound | 5 synthesized tones + custom audio: chime (default), ding, bell, music (arpeggio), alarm, custom (upload your own mp3/wav) |
| Volume | 0–100 |
| Preview | Play the selected sound immediately |
| Only when the window is in the background | Recommended default |
| Spoken announcement | System TTS says a line (editable, default “任务完成了”) |
| System notification | Also raise a Windows notification |
| Also alert for subagents | Off by default |
| Custom audio | Upload a local audio file (≤12 MB, kept in the browser's IndexedDB) |

Changes apply immediately and are stored on the host in `~/.dsh/dsh-complete-chime/settings.json`.

> Why host-side storage: the DSH desktop host boots the web app on a random port, so the page origin — and `localStorage` with it — changes on every launch.

## Install

```sh
dsh plugin --profile desktop add dsh-complete-chime
```

or from this repository:

```sh
dsh plugin --profile desktop add github:<owner>/dsh-complete-chime
```

Then **fully restart the DSH desktop app** (the bundle is mounted at boot; a page refresh is not enough). Open Settings (Ctrl+, or the sidebar's bottom-left account menu → Settings) and find **Completion chime**.

## How it works

- `lib/index.js` — host half: owns `~/.dsh/dsh-complete-chime/settings.json` and serves a loopback-only route `GET/PUT /api/dsh-complete-chime/settings` (loopback socket, same-origin check, 64 KB body cap, whitelisted fields; a corrupt file falls back to defaults).
- `lib/client.js` — hand-written `__ModuleLoader__` bundle, no build step. Subscribes to `ctx.sessions.list`, watches `running` transitions, synthesizes the chime with oscillators and gain envelopes, syncs settings with the host route, and registers the settings page into the `settings.section` slot.

## Tests

```sh
node test/run.mjs    # client bundle: 47 assertions
node test/host.mjs   # host route + sanitizer: 28 assertions
```

Both run headless in Node with a fake browser (window / AudioContext / localStorage / fetch), no browser required.

## License

MIT
