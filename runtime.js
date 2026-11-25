import { randomUUID } from 'node:crypto'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export const DEFAULTS = Object.freeze({
  enabled: false, owner: '', projects: [], auth: 'bearer',
  tokenRef: 'TAVLO_TAPD_TOKEN', apiUserRef: 'TAVLO_TAPD_API_USER', apiKeyRef: 'TAVLO_TAPD_API_KEY',
  intervalSeconds: 300, maxNewPerScope: 25,
})

const numericId = z.string().regex(/^[0-9]{1,32}$/)
const workspaceUuid = z.uuid()
const statuses = z.array(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/)).max(32)
export const projectConfig = z.strictObject({ workspaceId: numericId, stories: statuses, tasks: statuses, targetWorkspaceId: workspaceUuid.optional() })
const refName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(128)
const enabledConfig = z.strictObject({
  enabled: z.literal(true),
  owner: z.string().trim().min(1).max(128).refine(value => !/[<>|;,\p{Cc}]/u.test(value)),
  projects: z.array(projectConfig).min(1).max(20),
  auth: z.enum(['bearer', 'basic']), tokenRef: refName, apiUserRef: refName, apiKeyRef: refName,
  intervalSeconds: z.number().int().min(30).max(86400), maxNewPerScope: z.number().int().min(1).max(1000),
  lookbackDays: z.number().int().min(1).max(365).optional(),
  companyId: numericId.optional(),
  seedWorkspaceId: numericId.optional(),
})

class BridgeFailure extends Error {
  constructor(code) { super(code); this.code = code }
}

/** No credentials, network, timers or storage when disabled or invalid. */
export function parseConfig(config = {}) {
  const complete = { ...DEFAULTS, ...config }
  if (complete.enabled === false) return null
  const parsed = enabledConfig.safeParse({
    ...complete,
    projects: Array.isArray(complete.projects)
      ? complete.projects.map(project => project && typeof project === 'object'
        ? { stories: [], tasks: [], ...project } : project)
      : complete.projects,
  })
  if (!parsed.success) throw new BridgeFailure('invalid-config')
  const { owner, projects, ...options } = parsed.data
  if (new Set(projects.map(project => project.workspaceId)).size !== projects.length) {
    throw new BridgeFailure('duplicate-project')
  }
  const scopes = projects.flatMap(({ workspaceId, targetWorkspaceId, stories, tasks }) =>
    [['story', stories], ['task', tasks]].filter(([, values]) => values.length)
      .map(([objectType, values]) => ({ workspaceId, objectType, owner, statuses: [...new Set(values)],
        ...(targetWorkspaceId ? { targetWorkspaceId } : {}) })))
  if (!scopes.length) throw new BridgeFailure('missing-scopes')
  return { ...options, scopes }
}

/** Resolve fresh for each round. Never fall back between auth modes or put secrets in a URL. */
export async function resolveAuthorization(credentials, config, signal) {
  async function read(ref) {
    signal?.throwIfAborted()
    let record
    try { record = await credentials.resolve(credentialRef(ref)) }
    catch { throw new BridgeFailure('credentials-unavailable') }
    signal?.throwIfAborted()
    if (typeof record?.value !== 'string' || !record.value.trim()) throw new BridgeFailure('missing-credentials')
    return record.value
  }
  if (config.auth === 'bearer') return authorizationHeader('bearer', { token: await read(config.tokenRef) })
  return authorizationHeader('basic', { apiUser: await read(config.apiUserRef), apiKey: await read(config.apiKeyRef) })
}

export function authorizationHeader(auth, secret) {
  if (auth === 'bearer') {
    const token = secret.token?.trim()
    if (!token || !/^[-A-Za-z0-9._~+/]+=*$/.test(token)) throw new BridgeFailure('invalid-credentials')
    return `Bearer ${token}`
  }
  const user = secret.apiUser?.trim()
  const key = secret.apiKey
  if (!user || !key?.trim() || /[:\p{Cc}]/u.test(user) || /\p{Cc}/u.test(key)) throw new BridgeFailure('invalid-credentials')
  return `Basic ${Buffer.from(`${user}:${key}`, 'utf8').toString('base64')}`
}

const externalRef = z.strictObject({
  provider: z.literal('tapd'), connectionId: z.uuid(), scopeId: numericId,
  objectType: z.enum(['story', 'task']), objectId: numericId,
  url: z.string(),
}).superRefine((ref, issue) => {
  const path = ref.objectType === 'story' ? 'stories' : 'tasks'
  if (ref.url !== `https://www.tapd.cn/${ref.scopeId}/prong/${path}/view/${ref.objectId}`) {
    issue.addIssue({ code: 'custom', path: ['url'], message: 'Invalid source URL' })
  }
})
const ledgerRecord = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('imported') }),
  z.strictObject({ kind: z.literal('pending'), input: z.strictObject({
    requestId: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/), title: z.string().trim().min(1),
    brief: z.string(), dueDate: z.iso.date().optional(), workspaceId: workspaceUuid.optional(), externalRef,
  }) }),
])

export const tapdDomain = defineDomain({
  name: 'tavlo_tapd_bridge', version: 1, layout: 'per-record',
  global: { initial: {}, schema: z.strictObject({ connectionId: z.uuid().optional() }) },
  tables: { imports: domainTable(ledgerRecord) },
})

/** Only pending intent and lightweight receipt records are persisted; never credentials. */
export async function connectionLedger(domain, signal) {
  const table = domain.table('imports')
  let { connectionId } = domain.global.get()
  if (!connectionId) {
    if (table.size) throw new BridgeFailure('ledger-invalid')
    signal.throwIfAborted()
    connectionId = randomUUID()
    await domain.global.set({ connectionId })
  }
  function checkIdentity(key, record) {
    if (record?.kind !== 'pending') return
    const ref = record.input.externalRef
    if (ref.connectionId !== connectionId || key !== `${ref.scopeId}:${ref.objectType}:${ref.objectId}`) {
      throw new BridgeFailure('ledger-invalid')
    }
  }
  function storageKey(key) {
    // The JSON per-record backend uses each key as one filesystem component.
    if (!/^[0-9]{1,32}:(story|task):[0-9]{1,32}$/.test(key)) throw new BridgeFailure('ledger-invalid')
    return key.replaceAll(':', '-')
  }
  return {
    connectionId,
    ledger: {
      get(key) {
        const record = table.get(storageKey(key))
        checkIdentity(key, record)
        return record
      },
      put(key, value) {
        signal.throwIfAborted()
        const parsed = ledgerRecord.safeParse(value)
        if (!parsed.success) throw new BridgeFailure('ledger-invalid')
        checkIdentity(key, parsed.data)
        return table.put(storageKey(key), parsed.data)
      },
    },
  }
}

const MAX_TIMER_MS = 2_147_483_647

/** Run immediately, then wait after completion (not setInterval). Stop also drains the round. */
export function startPolling({ intervalMs, run, onError, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  const controller = new AbortController()
  const { signal } = controller
  let timer
  let active
  let stopPromise

  function arm(deadline) {
    if (signal.aborted) return
    timer = schedule(() => {
      timer = undefined
      if (signal.aborted) return
      if (deadline > now()) { arm(deadline); return }
      tick()
    }, Math.max(0, Math.min(MAX_TIMER_MS, deadline - now())))
    timer?.unref?.()
  }
  function tick() {
    active = (async () => {
      let delay = intervalMs
      try {
        const result = await run(signal)
        const retry = result?.retryAfterMs
        if (Number.isFinite(retry) && retry > delay) delay = Math.min(retry, Number.MAX_SAFE_INTEGER - now())
      } catch (error) {
        if (!signal.aborted) onError(error)
      } finally {
        if (!signal.aborted) arm(now() + delay)
      }
    })()
  }
  arm(now())
  return () => {
    if (!stopPromise) {
      controller.abort()
      if (timer !== undefined) cancel(timer)
      stopPromise = (async () => { await active })()
    }
    return stopPromise
  }
}
