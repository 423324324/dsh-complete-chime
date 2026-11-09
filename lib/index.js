/**
 * Host half of dsh-complete-chime.
 *
 * The chime itself plays in the browser (WebAudio), but the settings have to
 * live on the host: the desktop host boots the web app on port 0, so the page
 * origin — and with it localStorage — changes on every launch. This entry
 * therefore owns one small JSON file and exposes it over a loopback-only route:
 *
 *   GET  /api/dsh-complete-chime/settings   → { ok, settings }
 *   PUT  /api/dsh-complete-chime/settings   → { ok, settings }
 *
 * Everything about the request is fenced: loopback socket, same-origin, and a
 * JSON body cap. A broken settings file falls back to defaults instead of
 * failing the boot.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'dsh-complete-chime'

export const inject = ['webServer']

const ROUTE = '/api/dsh-complete-chime/settings'
const MAX_BODY_BYTES = 64 * 1024
const MAX_TEXT = 200

const DEFAULTS = {
  enabled: true,
  sound: 'chime',
  volume: 70,
  alwaysOn: true,
  announce: false,
  announceText: '任务完成了',
  subagents: false,
  notify: false,
}

const SOUNDS = ['chime', 'ding', 'bell', 'music', 'alarm', 'custom']
const BOOLEANS = ['enabled', 'alwaysOn', 'announce', 'subagents', 'notify']

/** `~/.dsh` unless the host was pointed somewhere else. */
function dataRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'dsh-complete-chime')
}

function settingsPath() {
  return path.join(dataRoot(), 'settings.json')
}

/** Accept only the known keys, with the right types, clamped. */
export function sanitize(raw) {
  const out = { ...DEFAULTS }
  if (raw && typeof raw === 'object') {
    for (const key of BOOLEANS) {
      if (typeof raw[key] === 'boolean') out[key] = raw[key]
    }
    if (typeof raw.sound === 'string' && SOUNDS.includes(raw.sound)) out.sound = raw.sound
    if (typeof raw.volume === 'number' && Number.isFinite(raw.volume)) {
      out.volume = Math.max(0, Math.min(100, Math.round(raw.volume)))
    }
    if (typeof raw.announceText === 'string') {
      const text = raw.announceText.trim()
      out.announceText = text ? text.slice(0, MAX_TEXT) : DEFAULTS.announceText
    }
  }
  return out
}

async function load() {
  try {
    const text = await fs.readFile(settingsPath(), 'utf8')
    return sanitize(JSON.parse(text))
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      // Corrupt or unreadable: keep the defaults rather than failing the boot.
      console.warn('[dsh-complete-chime] settings unreadable, using defaults:', error && error.message)
    }
    return { ...DEFAULTS }
  }
}

async function save(next) {
  const dir = dataRoot()
  await fs.mkdir(dir, { recursive: true })
  const target = settingsPath()
  const temporary = `${target}.${process.pid}.tmp`
  await fs.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8')
  await fs.rename(temporary, target)
  return next
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function isLoopback(address) {
  if (typeof address !== 'string') return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function isSameOrigin(req, host) {
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    try {
      const url = new URL(origin)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
      const hostname = url.hostname
      if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') return false
      return host.length === 0 || url.host === host
    } catch {
      return false
    }
  }
  return true
}

function isTrustedRequest(req, reqHost, bindHost) {
  if (!isLoopback(req.socket && req.socket.remoteAddress)) return false
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  const host = bindHost && /:\d+$/.test(bindHost) ? bindHost : reqHost
  return isSameOrigin(req, host)
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function createHandler(bindHost) {
  return async (req, res) => {
    const method = req.method || 'GET'
    const reqHost = typeof req.headers.host === 'string' ? req.headers.host : ''
    const allowed = method === 'HEAD' ? 'GET' : method
    if (allowed !== 'GET' && allowed !== 'PUT' && allowed !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    if (!isTrustedRequest(req, reqHost, bindHost)) {
      sendJson(res, 403, { ok: false, error: 'forbidden' })
      return
    }
    if (allowed === 'GET') {
      sendJson(res, 200, { ok: true, settings: await load() })
      return
    }
    let parsed
    try {
      const text = await readBody(req)
      parsed = JSON.parse(text || '{}')
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String((error && error.message) || 'bad request') })
      return
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      sendJson(res, 400, { ok: false, error: 'settings must be an object' })
      return
    }
    try {
      const saved = await save(sanitize(parsed))
      sendJson(res, 200, { ok: true, settings: saved })
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String((error && error.message) || 'write failed') })
    }
  }
}

export function apply(ctx) {
  const bindHost = typeof (ctx.webServer && ctx.webServer.host) === 'string' ? ctx.webServer.host : ''
  const handler = createHandler(bindHost)
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: ROUTE, handler }), 'complete-chime: settings route')
}
