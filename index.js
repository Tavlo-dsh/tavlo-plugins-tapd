import s from '@deepseek-ai/schemastery'
import { connectionLedger, DEFAULTS, parseConfig, startPolling, tapdDomain } from './runtime.js'
import { scanTapd, tapdModifiedWindow } from './tapd.js'
import { syncRound } from './sync.js'
import { createSettings, mountSettings } from './settings.js'

export const name = 'tavlo-tapd'
export const inject = ['credentials', 'storageDomain']

/** All values are public profile configuration. Credential values are never accepted here. */
export const Config = s.object({
  enabled: s.boolean().default(DEFAULTS.enabled),
  owner: s.string().default(DEFAULTS.owner),
  projects: s.array(s.object({
    workspaceId: s.string().required(),
    targetWorkspaceId: s.string(),
    stories: s.array(s.string()).default([]),
    tasks: s.array(s.string()).default([]),
  })).default([]),
  auth: s.union(['bearer', 'basic']).default(DEFAULTS.auth),
  tokenRef: s.string().default(DEFAULTS.tokenRef),
  apiUserRef: s.string().default(DEFAULTS.apiUserRef),
  apiKeyRef: s.string().default(DEFAULTS.apiKeyRef),
  intervalSeconds: s.natural().min(30).max(86400).default(DEFAULTS.intervalSeconds),
  maxNewPerScope: s.natural().min(1).max(1000).default(DEFAULTS.maxNewPerScope),
  lookbackDays: s.natural().min(1).max(365),
  companyId: s.string(),
  seedWorkspaceId: s.string(),
})

const configCodes = new Set(['invalid-config', 'duplicate-project', 'missing-scopes'])
const credentialCodes = new Set(['missing-credentials', 'invalid-credentials', 'credentials-unavailable'])
const scopeCodes = new Set(['ok', 'scope-limit', 'rate-limit', 'auth', 'timeout', 'scan-limit', 'scan-failed',
  'task-failed', 'task-capacity', 'task-write-unknown', 'workspace-unavailable', 'ledger-failed', 'unsupported-tasks', 'aborted'])
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0

function poll(settings, options, tasks, storage, log, hasWorkspace) {
  let previousPause
  const pause = code => {
    if (previousPause !== code) log('warn', `sync paused (${code})`)
    previousPause = code
  }
  const report = ({ workspaceId, objectType, code, scanned, candidates, created, duplicates, suppressed, failed }) => {
    if (code === 'aborted') return
    const scope = /^[0-9]{1,32}$/.test(workspaceId) && ['story', 'task'].includes(objectType) ? `${workspaceId}/${objectType}` : 'unknown'
    const knownCode = scopeCodes.has(code) ? code : 'sync-failed'
    log(knownCode === 'ok' ? 'info' : 'warn', `${scope} ${knownCode} scanned=${count(scanned)} candidates=${count(candidates)} created=${count(created)} duplicates=${count(duplicates)} suppressed=${count(suppressed)} failed=${count(failed)}`)
  }
  log('info', `sync enabled; ${options.scopes.length} scope(s), interval=${options.intervalSeconds}s`)
  return startPolling({
    intervalMs: options.intervalSeconds * 1000,
    async run(signal) {
      let authorization
      try { authorization = await settings.authorization(options, signal) }
      catch (error) {
        if (!signal.aborted) pause(credentialCodes.has(error?.code) ? error.code : 'credentials-unavailable')
        return
      }
      signal.throwIfAborted()
      let domain
      try {
        domain = await storage.open(tapdDomain)
        signal.throwIfAborted()
        const { connectionId, ledger } = await connectionLedger(domain, signal)
        signal.throwIfAborted()
        // Capture one rolling TAPD date window for every project/type in this round.
        const modifiedWindow = tapdModifiedWindow(options.lookbackDays)
        const result = await syncRound({ tasks, ledger, connectionId, scopes: options.scopes,
          maxNewPerScope: options.maxNewPerScope, authorization, scan: input => scanTapd({ ...input, modifiedWindow }),
          signal, report, hasWorkspace })
        previousPause = undefined
        return result
      } finally {
        if (domain) {
          try { await domain.close() }
          catch { if (!signal.aborted) log('warn', 'sync ledger close failed') }
        }
      }
    },
    onError() { pause('sync-or-ledger-unavailable') },
  })
}

export async function apply(ctx, config) {
  const logger = ctx.get('logger')
  const log = (level, text) => logger?.[level]?.(`tavlo-tapd: ${text}`)
  const storage = ctx.get('storageDomain')
  let tasks
  const workspaceRegistry = () => ctx.get('workspaceRegistry')
  const hasWorkspace = id => Boolean(workspaceRegistry()?.get(id))
  const settings = await createSettings(ctx.get('credentials'), config, () => Boolean(tasks), () => workspaceRegistry()?.list())
  let stop, stopping = false, tail = Promise.resolve()

  // Serial disposal prevents an old scope and one just saved from writing simultaneously.
  function reconcile() {
    const step = tail.then(async () => {
      if (stop) { await stop(); stop = undefined }
      if (stopping) return
      const snapshot = settings.snapshot()
      let options
      try { options = parseConfig(snapshot.config) }
      catch (error) {
        log('warn', `paused (${configCodes.has(error?.code) ? error.code : 'invalid-config'})`)
        return
      }
      if (!options) { log('info', 'loaded; sync disabled (enabled=false)'); return }
      if (!tasks) { log('info', 'sync configured; waiting for Tavlo TaskService'); return }
      stop = poll(snapshot, options, tasks, storage, log, hasWorkspace)
    })
    tail = step.catch(() => { log('warn', 'sync paused (runtime-error)') })
    return tail
  }
  ctx.effect(() => async () => { stopping = true; await reconcile() }, 'tavlo-tapd: sync lifecycle')
  ctx.inject(['connection'], branch => {
    branch.effect(() => mountSettings(branch.get('connection'), settings, reconcile), 'tavlo-tapd: owner-only settings')
  })
  ctx.inject(['taskService'], branch => {
    branch.effect(() => {
      const binding = branch.get('taskService')
      tasks = binding
      void reconcile()
      return () => {
        if (tasks !== binding) return
        tasks = undefined
        return reconcile()
      }
    }, 'tavlo-tapd: TaskService binding')
  })
  await reconcile()
}
