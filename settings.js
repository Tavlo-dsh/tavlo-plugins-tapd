import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { z } from 'zod'
import { DEFAULTS, authorizationHeader, parseConfig, projectConfig, resolveAuthorization } from './runtime.js'
import { AutomaticProjectListError, discoverProjectNames, discoverProjects, discoverStatuses, discoveryErrorCode, requiredTapdNickname, tapdNickname } from './metadata.js'
import { TapdError } from './tapd.js'

export const SETTINGS_METHOD = 'tavlo-tapd/settings'
export const SETTINGS_KEY = credentialKey('tavlo-tapd', 'settings')
const endpoint = `/api/${SETTINGS_METHOD}`
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1)
const workspaceOption = z.object({ id: z.uuid(), title: z.string(), path: z.string() })
const authMode = z.enum(['bearer', 'basic'])
const tapdId = z.string().regex(/^\d{1,32}$/u)
const visualConfig = z.strictObject({
  enabled: z.boolean(), auth: authMode,
  owner: tapdNickname, projects: z.array(projectConfig).max(20), companyId: tapdId.optional(), seedWorkspaceId: tapdId.optional(),
  intervalSeconds: z.number().int().min(30).max(86400), maxNewPerScope: z.number().int().min(1).max(1000),
  lookbackDays: z.number().int().min(1).max(365).optional(),
})
const secretValues = z.union([
  z.strictObject({ token: z.string().min(1).max(4096) }),
  z.strictObject({ apiUser: z.string().min(1).max(512), apiKey: z.string().min(1).max(4096) }),
])
const credentialChange = z.union([
  z.strictObject({ mode: z.literal('use-refs') }),
  z.strictObject({ mode: z.literal('replace'), token: z.string().min(1).max(4096) }),
  z.strictObject({ mode: z.literal('replace'), apiUser: z.string().min(1).max(512), apiKey: z.string().min(1).max(4096) }),
])
const saveInput = z.strictObject({ expectedRevision: revision, config: z.unknown(), credentials: z.unknown().optional() })
const saveCredentialsInput = z.strictObject({ expectedRevision: revision, auth: authMode, credentials: z.unknown() })
const discoveryAuth = { auth: authMode, credentials: z.unknown().optional() }
const projectDiscoveryInput = z.union([
  z.strictObject({ ...discoveryAuth, auth: z.literal('bearer'), auto: z.literal(true) }),
  z.strictObject({
    ...discoveryAuth, companyId: tapdId.optional(), seedWorkspaceId: tapdId.optional(),
    nick: requiredTapdNickname.optional(),
  }),
])
const statusDiscoveryInput = z.strictObject({ ...discoveryAuth, workspaceId: tapdId })
const projectNamesInput = z.strictObject({
  auth: authMode, workspaceIds: z.array(tapdId).min(1).max(20).refine(ids => new Set(ids).size === ids.length),
})
const grant = z.strictObject({
  version: z.literal(1), revision: revision.min(1), config: visualConfig, secret: secretValues.optional(),
})
const emptyInput = z.strictObject({})

class SettingsError extends Error {
  constructor(code) { super(code); this.code = code }
}

const messages = {
  'bad-request': 'Invalid TAPD settings request.',
  'revision-conflict': 'Settings changed. Reload the latest settings before saving.',
  'invalid-config': 'Check the project IDs, status keys, owner and sync limits.',
  'duplicate-project': 'Each TAPD project can only appear once.',
  'missing-scopes': 'To enable sync, configure at least one project and work item status.',
  'invalid-credentials': 'Check the selected credential type and credential fields.',
  'workspace-unavailable': 'The selected DSH workspace is unavailable. Refresh the list or choose another workspace.',
  'settings-unavailable': 'TAPD settings are temporarily unavailable.',
  'project-context-required': 'Enter a TAPD company ID or a known project ID, and for a personal token also enter the TAPD nickname.',
}
const explicitProjectFallback = 'To try explicit discovery, enter a TAPD company ID or known project ID and your TAPD nickname. You can also enter project IDs manually.'
const discoveryMessages = {
  'tapd/auth': 'TAPD rejected the supplied credentials.',
  'tapd/current-user-unavailable': `TAPD could not look up a usable current-user nickname with this token. ${explicitProjectFallback}`,
  'tapd/discovery-forbidden': 'The selected TAPD credential does not have access to this metadata. You can enter the values manually.',
  'tapd/rate-limit': 'TAPD rate limit reached. Try again later.',
  'tapd/http': 'TAPD returned an HTTP error.',
  'tapd/network': 'Could not reach TAPD.',
  'tapd/aborted': 'TAPD discovery was cancelled.',
  'tapd/timeout': 'TAPD discovery timed out.',
  'tapd/malformed': 'TAPD did not return usable metadata. You can enter the values manually.',
  'tapd/api': 'TAPD did not allow or could not complete discovery. Check the selected credentials and their permissions, or enter the values manually.',
  'tapd/discovery-limit': 'The TAPD status list exceeds the discovery limit. Enter the status keys manually.',
}

const automaticProjectListMessages = {
  'tapd/discovery-forbidden': `This TAPD token is not permitted to list participant projects without a company context. ${explicitProjectFallback}`,
  'tapd/malformed': `TAPD did not return a usable participant project list without a company context. ${explicitProjectFallback}`,
  'tapd/api': `TAPD could not list participant projects without a company context. ${explicitProjectFallback}`,
}

function discoveryFailure(error) {
  const code = discoveryErrorCode(error)
  if (code === undefined) return undefined
  if (error instanceof AutomaticProjectListError) {
    if (code === 'tapd/http' && error.status === 400) return {
      code: 'tapd/project-context-required',
      message: `TAPD rejected the participant project request without a company context. ${explicitProjectFallback}`,
    }
    if (Object.hasOwn(automaticProjectListMessages, code)) return { code, message: automaticProjectListMessages[code] }
  }
  if (Object.hasOwn(discoveryMessages, code)) return { code, message: discoveryMessages[code] }
}

function checkAborted(signal) {
  if (signal?.aborted) throw new TapdError('tapd/aborted')
}

function projectDiscoveryContext(input, config) {
  if ('auto' in input) return { auto: true }
  const seedWorkspaceId = input.seedWorkspaceId ?? (input.companyId ? undefined : tapdId.safeParse(config.seedWorkspaceId).data)
  // A linked project takes precedence over the legacy company setting unless a caller expressly supplies a company.
  const companyId = input.companyId ?? (seedWorkspaceId ? undefined : tapdId.safeParse(config.companyId).data)
  const hasContext = companyId !== undefined || seedWorkspaceId !== undefined
  // For a context-free bearer request, the credential's nickname is authoritative, not the saved owner.
  if (input.auth === 'bearer' && !hasContext) return { auto: true }
  const nick = input.nick ?? requiredTapdNickname.safeParse(config.owner).data
  if (!hasContext || (input.auth === 'bearer' && !nick)) throw new SettingsError('project-context-required')
  return { companyId, seedWorkspaceId, nick }
}

function admitConfig(input) {
  const parsed = visualConfig.safeParse(input)
  if (!parsed.success) throw new SettingsError('invalid-config')
  const config = parsed.data
  if (new Set(config.projects.map(row => row.workspaceId)).size !== config.projects.length) {
    throw new SettingsError('duplicate-project')
  }
  if (config.enabled && (!config.projects.length || !config.projects.some(row => row.stories.length || row.tasks.length))) {
    throw new SettingsError('missing-scopes')
  }
  try { parseConfig(config) }
  catch (error) { throw new SettingsError(error?.code === 'missing-scopes' ? 'missing-scopes' : 'invalid-config') }
  return config
}

function admitCredentialChange(input, auth) {
  const change = credentialChange.safeParse(input)
  if (!change.success) throw new SettingsError('invalid-credentials')
  const { mode, ...secret } = change.data
  if (mode === 'use-refs') return { mode }
  try { authorizationHeader(auth, secret) }
  catch { throw new SettingsError('invalid-credentials') }
  return { mode, secret }
}

function admitRecord(record) {
  if (record === undefined) return undefined
  const parsed = grant.safeParse(record?.payload)
  if (record?.kind !== 'grant' || !parsed.success) throw new SettingsError('settings-unavailable')
  return parsed.data
}

function projection(config) {
  const { enabled, auth, owner, projects, intervalSeconds, maxNewPerScope, companyId, seedWorkspaceId, lookbackDays } = config
  return { enabled, auth, owner, projects, intervalSeconds, maxNewPerScope,
    ...(companyId === undefined ? {} : { companyId }), ...(seedWorkspaceId === undefined ? {} : { seedWorkspaceId }),
    ...(lookbackDays === undefined ? {} : { lookbackDays }) }
}

/** One owner-scoped grant keeps the settings revision and any visual credentials atomic. */
export async function createSettings(credentials, profileConfig, isBoardReady, listWorkspaces, { fetchImpl } = {}) {
  const profile = { ...DEFAULTS, ...profileConfig }
  async function workspaceCatalog() {
    try {
      const parsed = z.array(workspaceOption).safeParse(await listWorkspaces?.())
      if (parsed.success) return { workspaceStatus: 'ready', workspaces: parsed.data }
    } catch { /* The settings remain editable if the registry is unavailable. */ }
    return { workspaceStatus: 'unavailable', workspaces: [] }
  }
  const loadRecord = async () => admitRecord(await credentials.readRecord?.(SETTINGS_KEY))
  let initial
  try { initial = await loadRecord() } catch { throw new SettingsError('settings-unavailable') }
  let current = initial
  // In a visual record, omitted lookback/seed values mean unrestricted history and no linked project.
  const { lookbackDays: _profileLookback, seedWorkspaceId: _profileSeed, ...profileFallback } = profile
  const effective = record => record ? { ...profileFallback, ...record.config } : { ...profile }
  const authorization = (options, signal, record = current) => {
    // A credential set for the other auth mode must never be sent to TAPD.
    const relevant = record?.secret && (('token' in record.secret) === (options.auth === 'bearer'))
    if (relevant) return authorizationHeader(options.auth, record.secret)
    return resolveAuthorization(credentials, options, signal)
  }
  async function discoveryAuthorization(auth, changeInput, config, record, signal) {
    checkAborted(signal)
    const change = changeInput === undefined ? undefined : credentialChange.safeParse(changeInput)
    if (change && !change.success) throw new SettingsError('invalid-credentials')
    try {
      if (change?.data.mode === 'replace') return authorizationHeader(auth, change.data)
      const options = { ...config, auth }
      return change?.data.mode === 'use-refs'
        ? await resolveAuthorization(credentials, options, signal)
        : await authorization(options, signal, record)
    } catch {
      checkAborted(signal)
      throw new SettingsError('invalid-credentials')
    }
  }
  async function view(record) {
    const config = effective(record)
    let credentialSource = 'none'
    try {
      await authorization(config, undefined, record)
      credentialSource = record?.secret && (('token' in record.secret) === (config.auth === 'bearer')) ? 'visual' : 'refs'
    } catch { /* Only presence is projected, never errors from the backing store. */ }
    return { revision: record?.revision ?? 0, source: record ? 'visual' : 'profile', config: projection(config),
      configured: credentialSource !== 'none', credentialSource,
      syncState: !config.enabled ? 'disabled' : isBoardReady() ? 'ready' : 'waiting-for-board',
      ...await workspaceCatalog() }
  }
  async function update(expectedRevision, build) {
    const result = await credentials.modifyRecord(SETTINGS_KEY, async raw => {
      const previous = admitRecord(raw)
      if ((previous?.revision ?? 0) !== expectedRevision) throw new SettingsError('revision-conflict')
      const { config, secret } = await build(previous)
      const next = { version: 1, revision: expectedRevision + 1, config }
      if (secret !== undefined) next.secret = secret
      if (!grant.safeParse(next).success) throw new SettingsError('settings-unavailable')
      return { kind: 'grant', payload: next }
    })
    const committed = admitRecord(result)
    if (!committed) throw new SettingsError('settings-unavailable')
    current = committed
    return view(committed)
  }
  return {
    snapshot() {
      const record = current
      return { config: effective(record), authorization: (options, signal) => authorization(options, signal, record) }
    },
    async get() { return view(await loadRecord()) },
    async discoverProjects(input, signal) {
      const parsed = projectDiscoveryInput.safeParse(input)
      if (!parsed.success) throw new SettingsError('bad-request')
      checkAborted(signal)
      const record = await loadRecord()
      checkAborted(signal)
      const config = effective(record)
      const { auth, credentials: change } = parsed.data
      const context = projectDiscoveryContext(parsed.data, config)
      const header = await discoveryAuthorization(auth, change, config, record, signal)
      return discoverProjects({ auth, ...context, authorization: header, signal, fetchImpl })
    },
    async discoverProjectNames(input, signal) {
      const parsed = projectNamesInput.safeParse(input)
      if (!parsed.success) throw new SettingsError('bad-request')
      checkAborted(signal)
      const record = await loadRecord()
      const { auth, workspaceIds } = parsed.data
      const header = await discoveryAuthorization(auth, undefined, effective(record), record, signal)
      return discoverProjectNames({ workspaceIds, authorization: header, signal, fetchImpl })
    },
    async discoverStatuses(input, signal) {
      const parsed = statusDiscoveryInput.safeParse(input)
      if (!parsed.success) throw new SettingsError('bad-request')
      checkAborted(signal)
      const record = await loadRecord()
      const { auth, credentials: change, workspaceId } = parsed.data
      const header = await discoveryAuthorization(auth, change, effective(record), record, signal)
      return discoverStatuses({ workspaceId, authorization: header, signal, fetchImpl })
    },
    async save(input) {
      const parsed = saveInput.safeParse(input)
      if (!parsed.success) throw new SettingsError('bad-request')
      const config = admitConfig(parsed.data.config)
      const change = parsed.data.credentials === undefined ? undefined : admitCredentialChange(parsed.data.credentials, config.auth)
      return update(parsed.data.expectedRevision, async previous => {
        const oldTargets = new Map(effective(previous).projects.map(row => [row.workspaceId, row.targetWorkspaceId]))
        const changed = config.projects.filter(row => row.targetWorkspaceId && row.targetWorkspaceId !== oldTargets.get(row.workspaceId))
        if (changed.length) {
          const { workspaces } = await workspaceCatalog()
          const available = new Set(workspaces.map(row => row.id))
          if (changed.some(row => !available.has(row.targetWorkspaceId))) throw new SettingsError('workspace-unavailable')
        }
        return { config, secret: change ? change.secret : previous?.secret }
      })
    },
    async saveCredentials(input) {
      const parsed = saveCredentialsInput.safeParse(input)
      if (!parsed.success) throw new SettingsError('bad-request')
      const { expectedRevision, auth, credentials: change } = parsed.data
      const { secret } = admitCredentialChange(change, auth)
      // Keep the saved config as-is rather than copying any draft or inherited fields into it.
      return update(expectedRevision, previous => ({
        config: { ...(previous?.config ?? projection(effective())), auth }, secret,
      }))
    },
  }
}

/** Mount on the exact owner-only Connection route, not a generic public RPC handler. */
export function mountSettings(connection, settings, onSaved) {
  let writes = Promise.resolve()
  const dispose = connection.fetch.register({
    path: endpoint, methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      const headers = { 'cache-control': 'no-store' }
      if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        return new Response('Expected JSON', { status: 415, headers })
      }
      let body
      try { body = await request.text() } catch { return new Response('Bad request', { status: 400, headers }) }
      if (body.length > 131_072) return new Response('Request too large', { status: 413, headers })
      let envelope
      try { envelope = clientRequestSchema.safeParse(JSON.parse(body)) } catch { /* handled below */ }
      if (!envelope?.success || envelope.data.method !== SETTINGS_METHOD) return new Response('Bad request', { status: 400, headers })
      const { rpcId, payload } = envelope.data
      let result
      try {
        if (!payload || typeof payload !== 'object' || Object.keys(payload).length !== 2 || !Object.hasOwn(payload, 'input')) throw new SettingsError('bad-request')
        if (payload.operation === 'get' && emptyInput.safeParse(payload.input).success) {
          result = { ok: true, value: await settings.get() }
        } else if (payload.operation === 'save' || payload.operation === 'save-credentials') {
          const writing = writes.then(async () => {
            request.signal.throwIfAborted()
            const value = payload.operation === 'save'
              ? await settings.save(payload.input)
              : await settings.saveCredentials(payload.input)
            await onSaved()
            return value
          })
          writes = writing.catch(() => {})
          result = { ok: true, value: await writing }
        } else if (payload.operation === 'discover-projects') {
          result = { ok: true, value: await settings.discoverProjects(payload.input, request.signal) }
        } else if (payload.operation === 'discover-statuses') {
          result = { ok: true, value: await settings.discoverStatuses(payload.input, request.signal) }
        } else if (payload.operation === 'discover-project-names') {
          result = { ok: true, value: await settings.discoverProjectNames(payload.input, request.signal) }
        } else throw new SettingsError('bad-request')
      } catch (error) {
        const discovery = ['discover-projects', 'discover-statuses', 'discover-project-names'].includes(payload?.operation)
        const failure = discovery ? discoveryFailure(error) : undefined
        if (failure) {
          result = { ok: false, error: failure }
        } else {
          const code = error instanceof SettingsError && Object.hasOwn(messages, error.code) ? error.code : 'settings-unavailable'
          result = { ok: false, error: { code: `tapd/${code}`, message: messages[code] } }
        }
      }
      return Response.json({ type: 'server-response', rpcId, result }, { headers })
    },
  })
  return async () => { await dispose(); await writes }
}
