import assert from 'node:assert/strict'
import test from 'node:test'
import { createSettings, mountSettings, SETTINGS_KEY, SETTINGS_METHOD } from '../settings.js'
import { parseConfig } from '../runtime.js'

const base = { enabled: false, auth: 'bearer', owner: '', projects: [], intervalSeconds: 300, maxNewPerScope: 25 }
const enabled = { ...base, enabled: true, owner: 'worker', projects: [{ workspaceId: '12345678', stories: [], tasks: ['open'] }] }
function provider(refs = new Map()) {
  let record
  let tail = Promise.resolve()
  return {
    async readRecord(key) { assert.equal(key, SETTINGS_KEY); return structuredClone(record) },
    modifyRecord(key, updater) {
      assert.equal(key, SETTINGS_KEY)
      const pending = tail.then(async () => {
        record = (await updater(structuredClone(record))) ?? record
        return structuredClone(record)
      })
      tail = pending.catch(() => {})
      return pending
    },
    async resolve(ref) { if (refs.has(ref)) return { value: refs.get(ref) } },
  }
}

test('UI settings persist atomically with credentials but clients receive presence only; profile references still work', async () => {
  const credentials = provider(new Map([['COMPANY_TAPD', 'profile-credential']]))
  const profile = { ...enabled, owner: 'from-profile', tokenRef: 'COMPANY_TAPD' }
  const settings = await createSettings(credentials, profile, () => false)
  assert.deepEqual(await settings.get(), { revision: 0, source: 'profile', config: { ...enabled, owner: 'from-profile' },
    configured: true, credentialSource: 'refs', syncState: 'waiting-for-board', workspaces: [], workspaceStatus: 'unavailable' })
  const first = await settings.save({ expectedRevision: 0, config: enabled, credentials: { mode: 'replace', token: 'new-visual-credential' } })
  assert.equal(first.source, 'visual')
  assert.equal(first.revision, 1)
  assert.equal(first.credentialSource, 'visual')
  assert.doesNotMatch(JSON.stringify(first), /credential$|visual-credential|profile-credential|COMPANY_TAPD/)
  const auth = state => state.authorization(parseConfig(state.config))
  const before = settings.snapshot()
  assert.equal(await auth(before), 'Bearer new-visual-credential')
  const reloaded = await createSettings(credentials, { ...profile, owner: 'changed-profile' }, () => true)
  assert.equal((await reloaded.get()).syncState, 'ready')
  assert.equal(reloaded.snapshot().config.owner, 'worker')
  const second = await reloaded.save({ expectedRevision: 1, config: { ...enabled, maxNewPerScope: 3 } })
  assert.equal(second.credentialSource, 'visual', 'empty replacement preserves stored secret')
  const third = await reloaded.save({ expectedRevision: 2, config: enabled, credentials: { mode: 'use-refs' } })
  assert.equal(third.credentialSource, 'refs')
  assert.equal(await auth(reloaded.snapshot()), 'Bearer profile-credential')
  assert.equal(await auth(before), 'Bearer new-visual-credential', 'live old scopes never mix with new credentials')
  assert.equal((await credentials.readRecord(SETTINGS_KEY)).payload.secret, undefined)
})

test('validates mode and config, fences stale concurrent saves, and supports Basic without echoing fields', async () => {
  const credentials = provider()
  const settings = await createSettings(credentials, {}, () => true)
  await assert.rejects(settings.save({ expectedRevision: 0, config: { ...enabled, projects: [] } }), { code: 'missing-scopes' })
  await assert.rejects(settings.save({ expectedRevision: 0, config: { ...enabled, projects: [...enabled.projects, ...enabled.projects] } }), { code: 'duplicate-project' })
  await assert.rejects(settings.save({ expectedRevision: 0, config: { ...enabled, owner: 'a|b' } }), { code: 'invalid-config' })
  await assert.rejects(settings.save({ expectedRevision: 0, config: enabled, credentials: { mode: 'replace', apiUser: 'private', apiKey: 'private' } }), { code: 'invalid-credentials' })
  const config = { ...enabled, auth: 'basic' }
  const results = await Promise.allSettled([
    settings.save({ expectedRevision: 0, config, credentials: { mode: 'replace', apiUser: 'private-account', apiKey: 'private-key' } }),
    settings.save({ expectedRevision: 0, config: base }),
  ])
  assert.equal(results[1].reason?.code, 'revision-conflict')
  assert.equal(results[0].value?.credentialSource, 'visual')
  assert.doesNotMatch(JSON.stringify(results[0].value), /private-account|private-key/)
  const snapshot = settings.snapshot()
  assert.equal(await snapshot.authorization(parseConfig(snapshot.config)), `Basic ${Buffer.from('private-account:private-key').toString('base64')}`)
})

test('lists live matching workspaces, admits only available new mappings and preserves legacy settings', async () => {
  const credentials = provider()
  const id = 'e56a5888-fca8-49fa-bdf6-4b51e9b2a502'
  let workspaces = [{ id, title: 'Frontend', path: 'C:/code/frontend', privateExtra: true }]
  const settings = await createSettings(credentials, {}, () => true, () => workspaces)
  const mapped = { ...enabled, projects: [{ ...enabled.projects[0], targetWorkspaceId: id }] }
  assert.deepEqual((await settings.get()).workspaces, [{ id, title: 'Frontend', path: 'C:/code/frontend' }])
  assert.equal((await settings.get()).workspaceStatus, 'ready')
  await assert.rejects(settings.save({ expectedRevision: 0, config: { ...mapped, projects: [{ ...mapped.projects[0], targetWorkspaceId: '12345' }] } }), { code: 'invalid-config' })
  const first = await settings.save({ expectedRevision: 0, config: mapped })
  assert.equal(first.config.projects[0].targetWorkspaceId, id)
  workspaces = []
  assert.equal((await settings.get()).config.projects[0].targetWorkspaceId, id)
  await assert.rejects(settings.save({ expectedRevision: 1, config: { ...mapped, projects: [{ ...mapped.projects[0], workspaceId: '99887766' }] } }), { code: 'workspace-unavailable' })
  workspaces = undefined
  const second = await settings.save({ expectedRevision: 1, config: { ...mapped, enabled: false } })
  assert.equal(second.workspaceStatus, 'unavailable')
  assert.equal(second.config.projects[0].targetWorkspaceId, id)
  const third = await settings.save({ expectedRevision: 2, config: enabled })
  assert.equal(third.config.projects[0].targetWorkspaceId, undefined)
  await assert.rejects(settings.save({ expectedRevision: 3, config: mapped }), { code: 'workspace-unavailable' })
  assert.equal((await settings.get()).revision, 3)
})

test('the exact RPC endpoint returns no-store, hides error internals, and only reconciles committed saves', async () => {
  let route, unmounted = false, changes = 0
  const credentials = provider()
  const settings = await createSettings(credentials, {}, () => false)
  const dispose = mountSettings({ fetch: { register(next) { route = next; return async () => { unmounted = true } } } }, settings, () => { changes++ })
  assert.equal(route.path, `/api/${SETTINGS_METHOD}`)
  const request = (operation, input, method = SETTINGS_METHOD) => new Request(`http://localhost${route.path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: '1', method, payload: { operation, input } }),
  })
  const first = await route.fetch(request('get', {}))
  assert.equal(first.headers.get('cache-control'), 'no-store')
  assert.equal((await first.json()).result.value.syncState, 'disabled')
  assert.equal((await route.fetch(request('get', {}, 'other'))).status, 400)
  const failed = await (await route.fetch(request('save', { expectedRevision: 0, config: base, credentials: { mode: 'replace', token: 'bad\r\nprivate-sample' } }))).json()
  assert.equal(failed.result.error.code, 'tapd/invalid-credentials')
  assert.doesNotMatch(JSON.stringify(failed), /private-sample/)
  assert.equal(changes, 0)
  const last = await (await route.fetch(request('save', { expectedRevision: 0, config: base }))).json()
  assert.equal(last.result.value.revision, 1)
  assert.equal(changes, 1)
  await dispose()
  assert.equal(unmounted, true)
})

function mountTestRpc(settings, onSaved = () => {}) {
  let route
  const dispose = mountSettings({ fetch: { register(next) { route = next; return async () => {} } } }, settings, onSaved)
  assert.equal(route.path, `/api/${SETTINGS_METHOD}`)
  assert.deepEqual(route.methods, ['POST'])
  async function rpc(operation, input) {
    const response = await route.fetch(new Request(`http://localhost${route.path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: SETTINGS_METHOD, payload: { operation, input } }),
    }))
    assert.equal(response.headers.get('cache-control'), 'no-store')
    return (await response.json()).result
  }
  return { rpc, dispose }
}

test('credential-only save seeds the first grant from the profile projection without validating scopes', async () => {
  const credentials = provider()
  const config = { ...enabled, companyId: '123', seedWorkspaceId: '042', lookbackDays: 14,
    projects: [{ ...enabled.projects[0], tasks: [], targetWorkspaceId: 'e56a5888-fca8-49fa-bdf6-4b51e9b2a502' }] }
  let fetches = 0, catalogReads = 0
  const settings = await createSettings(credentials, { ...config, tokenRef: 'HIDDEN_PROFILE_REF' }, () => false,
    () => { catalogReads++; throw new Error('workspace registry unavailable') },
    { fetchImpl: async () => { fetches++; throw new Error('unexpected TAPD request') } })
  await assert.rejects(settings.save({ expectedRevision: 0, config }), { code: 'missing-scopes' })
  const { rpc, dispose } = mountTestRpc(settings)
  try {
    const result = await rpc('save-credentials', { expectedRevision: 0, auth: 'bearer', credentials: { mode: 'replace', token: 'first-visual-token' } })
    assert.deepEqual(result, { ok: true, value: { revision: 1, source: 'visual', config,
      configured: true, credentialSource: 'visual', syncState: 'waiting-for-board', workspaces: [], workspaceStatus: 'unavailable' } })
    assert.equal(catalogReads, 1, 'reads the catalog only for the public view, not to admit saved mappings')
    assert.deepEqual(await credentials.readRecord(SETTINGS_KEY), { kind: 'grant', payload: { version: 1, revision: 1, config,
      secret: { token: 'first-visual-token' } } })
    assert.equal(settings.snapshot().config.tokenRef, 'HIDDEN_PROFILE_REF')
    assert.equal(fetches, 0)
  } finally { await dispose() }
})

test('credential-only RPC replaces saved credentials, rejects malformed requests, and restores refs without changing other fields', async () => {
  const refs = new Map()
  const credentials = provider(refs)
  const id = 'e56a5888-fca8-49fa-bdf6-4b51e9b2a502'
  const config = { ...enabled, seedWorkspaceId: '042', lookbackDays: 14, intervalSeconds: 90, maxNewPerScope: 4,
    projects: [{ ...enabled.projects[0], stories: ['doing'], targetWorkspaceId: id }] }
  let catalog = [{ id, title: 'Frontend', path: 'C:/code/frontend' }], fetches = 0, reconciled = 0
  const settings = await createSettings(credentials, { companyId: '999' }, () => true, () => catalog,
    { fetchImpl: async () => { fetches++; throw new Error('unexpected TAPD request') } })
  await settings.save({ expectedRevision: 0, config, credentials: { mode: 'replace', token: 'old-secret' } })
  const before = settings.snapshot()
  catalog = undefined
  const { rpc, dispose } = mountTestRpc(settings, () => { reconciled++ })
  try {
    const update = { expectedRevision: 1, auth: 'bearer', credentials: { mode: 'replace', token: 'new-secret' } }
    const original = await credentials.readRecord(SETTINGS_KEY)
    for (const [request, code] of [
      [{ expectedRevision: 1, auth: 'bearer' }, 'bad-request'],
      [{ ...update, expectedRevision: -1 }, 'bad-request'],
      [{ ...update, auth: 'unknown' }, 'bad-request'],
      [{ ...update, config: { projects: [{}] } }, 'bad-request'],
      [{ ...update, credentials: null }, 'invalid-credentials'],
      [{ ...update, credentials: { mode: 'use-refs', token: 'must-not-leak' } }, 'invalid-credentials'],
      [{ ...update, credentials: { mode: 'replace', token: 'bad\r\nmust-not-leak' } }, 'invalid-credentials'],
      [{ ...update, auth: 'basic' }, 'invalid-credentials'],
      [{ ...update, auth: 'basic', credentials: { mode: 'replace', apiUser: 'must-not-leak' } }, 'invalid-credentials'],
    ]) {
      const result = await rpc('save-credentials', request)
      assert.equal(result.error?.code, `tapd/${code}`)
      assert.doesNotMatch(JSON.stringify(result), /must-not-leak|new-secret|old-secret/)
    }
    assert.deepEqual(await credentials.readRecord(SETTINGS_KEY), original)
    assert.equal(reconciled, 0)

    const bearer = await rpc('save-credentials', update)
    assert.deepEqual(bearer, { ok: true, value: { revision: 2, source: 'visual', config: { ...config, companyId: '999' },
      configured: true, credentialSource: 'visual', syncState: 'ready', workspaces: [], workspaceStatus: 'unavailable' } })
    assert.equal(await before.authorization(parseConfig(before.config)), 'Bearer old-secret')
    const current = settings.snapshot()
    assert.equal(await current.authorization(parseConfig(current.config)), 'Bearer new-secret')
    assert.deepEqual((await credentials.readRecord(SETTINGS_KEY)).payload, {
      version: 1, revision: 2, config, secret: { token: 'new-secret' },
    })

    const basic = await rpc('save-credentials', { expectedRevision: 2, auth: 'basic',
      credentials: { mode: 'replace', apiUser: 'visual-account', apiKey: 'visual-key' } })
    const basicHeader = Buffer.from('visual-account:visual-key').toString('base64')
    const basicSnapshot = settings.snapshot()
    assert.equal(await basicSnapshot.authorization(parseConfig(basicSnapshot.config)), `Basic ${basicHeader}`)
    assert.doesNotMatch(JSON.stringify(basic), /visual-account|visual-key/)
    assert.equal(JSON.stringify(basic).includes(basicHeader), false)
    assert.deepEqual(basic, { ok: true, value: { ...bearer.value, revision: 3, config: { ...bearer.value.config, auth: 'basic' } } })
    assert.deepEqual((await credentials.readRecord(SETTINGS_KEY)).payload, {
      version: 1, revision: 3, config: { ...config, auth: 'basic' }, secret: { apiUser: 'visual-account', apiKey: 'visual-key' },
    })

    const restored = await rpc('save-credentials', { expectedRevision: 3, auth: 'basic', credentials: { mode: 'use-refs' } })
    assert.deepEqual(restored, { ok: true, value: { ...basic.value, revision: 4, configured: false, credentialSource: 'none' } })
    assert.deepEqual((await credentials.readRecord(SETTINGS_KEY)).payload, { version: 1, revision: 4, config: { ...config, auth: 'basic' } })
    refs.set('TAVLO_TAPD_API_USER', 'host-account')
    refs.set('TAVLO_TAPD_API_KEY', 'host-key')
    const got = await rpc('get', {})
    assert.deepEqual(got, { ok: true, value: { ...restored.value, configured: true, credentialSource: 'refs' } })
    assert.equal(reconciled, 3)
    assert.equal(fetches, 0)
  } finally { await dispose() }
})

test('credential-only and combined RPC writes share the reconcile queue and reject a stale revision', async () => {
  const credentials = provider()
  const originalModify = credentials.modifyRecord
  let writes = 0, reconciles = 0
  credentials.modifyRecord = (...args) => { writes++; return originalModify(...args) }
  const settings = await createSettings(credentials, {}, () => true)
  const { promise: reconciling, resolve: start } = Promise.withResolvers()
  const { promise: mayFinish, resolve: finish } = Promise.withResolvers()
  const { rpc, dispose } = mountTestRpc(settings, async () => {
    if (++reconciles !== 1) return
    start()
    await mayFinish
  })
  const rotation = { expectedRevision: 0, auth: 'bearer', credentials: { mode: 'replace', token: 'only-winner' } }
  try {
    const first = rpc('save-credentials', rotation)
    await reconciling
    const combined = rpc('save', { expectedRevision: 0, config: { ...base, intervalSeconds: 60 } })
    await new Promise(setImmediate)
    assert.equal(writes, 1, 'combined save waits for credential-only reconciliation')
    finish()
    assert.equal((await first).value.revision, 1)
    const stale = await combined
    assert.equal(stale.error.code, 'tapd/revision-conflict')
    assert.equal(reconciles, 1, 'a rejected write does not reconcile')
    const rejectedRotation = await rpc('save-credentials', { ...rotation, credentials: { mode: 'replace', token: 'stale-secret' } })
    assert.equal(rejectedRotation.error.code, 'tapd/revision-conflict')
    assert.doesNotMatch(JSON.stringify(rejectedRotation), /stale-secret/)
    assert.deepEqual((await credentials.readRecord(SETTINGS_KEY)).payload, {
      version: 1, revision: 1, config: base, secret: { token: 'only-winner' },
    })
    assert.equal(reconciles, 1)
  } finally { finish(); await dispose() }
})

test('optional company ID and lookback are projected and validated; visual all clears a YAML window', async () => {
  const credentials = provider()
  const profile = { ...enabled, companyId: '123', lookbackDays: 30 }
  const settings = await createSettings(credentials, profile, () => true)
  const { config } = await settings.get()
  assert.deepEqual(config, profile)
  for (const lookbackDays of [0, 366, 2.5, null, '90']) {
    await assert.rejects(settings.save({ expectedRevision: 0, config: { ...enabled, lookbackDays } }), { code: 'invalid-config' })
  }
  await assert.rejects(settings.save({ expectedRevision: 0, config: { ...enabled, companyId: 'bad' } }), { code: 'invalid-config' })
  const selected = await settings.save({ expectedRevision: 0, config: { ...enabled, lookbackDays: 365, companyId: '321' } })
  assert.equal(selected.config.lookbackDays, 365)
  assert.equal(selected.config.companyId, '321')
  const all = await settings.save({ expectedRevision: 1, config: { ...enabled, companyId: '321' } })
  assert.equal(Object.hasOwn(all.config, 'lookbackDays'), false)
  assert.equal(parseConfig(settings.snapshot().config).lookbackDays, undefined)
  const reloaded = await createSettings(credentials, profile, () => true)
  assert.equal(Object.hasOwn((await reloaded.get()).config, 'lookbackDays'), false)
  assert.equal((await reloaded.get()).config.companyId, '321')
})

test('keeps only the linked project ID, prefers it to a legacy company ID, and can clear a YAML seed', async () => {
  const credentials = provider(new Map([['TAVLO_TAPD_TOKEN', 'host-token']]))
  const requests = []
  const profile = { ...enabled, companyId: '321', seedWorkspaceId: '0099' }
  const mocks = { fetchImpl: async url => {
    const { pathname, searchParams } = new URL(url)
    requests.push([pathname, Object.fromEntries(searchParams)])
    return Response.json(pathname === '/workspaces/get_workspace_info'
      ? { status: 1, data: { Workspace: { id: '0042', company_id: '987' } } }
      : { status: 1, data: [] })
  } }
  const settings = await createSettings(credentials, profile, () => true, undefined, mocks)
  assert.equal((await settings.get()).config.seedWorkspaceId, '0099')
  for (const seedWorkspaceId of ['https://www.tapd.cn/42/a?token=x', 42]) {
    await assert.rejects(settings.save({ expectedRevision: 0, config: { ...enabled, seedWorkspaceId } }), { code: 'invalid-config' })
  }
  await settings.save({ expectedRevision: 0, config: { ...enabled, companyId: '321', seedWorkspaceId: '0042' } })
  const reloaded = await createSettings(credentials, profile, () => true, undefined, mocks)
  assert.equal((await reloaded.get()).config.seedWorkspaceId, '0042')
  assert.deepEqual(requests, [], 'saving a link never reads TAPD by itself')
  await reloaded.discoverProjects({ auth: 'bearer' })
  assert.deepEqual(requests, [
    ['/workspaces/get_workspace_info', { workspace_id: '0042' }],
    ['/workspaces/user_participant_projects', { company_id: '987', nick: 'worker' }],
  ])
  const cleared = await reloaded.save({ expectedRevision: 1, config: { ...enabled, companyId: '321' } })
  assert.equal(Object.hasOwn(cleared.config, 'seedWorkspaceId'), false)
  assert.equal(parseConfig(reloaded.snapshot().config).seedWorkspaceId, undefined)
})

test('discovery uses a draft replacement, matching saved grant or host references without saving', async () => {
  const credentials = provider(new Map([
    ['TAVLO_TAPD_TOKEN', 'host-token'], ['TAVLO_TAPD_API_USER', 'host-user'], ['TAVLO_TAPD_API_KEY', 'host-key'],
  ]))
  const originalModify = credentials.modifyRecord
  let writes = 0
  credentials.modifyRecord = (...args) => { writes++; return originalModify(...args) }
  const calls = []
  const settings = await createSettings(credentials, { ...enabled, companyId: '123' }, () => true, undefined, {
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(url), header: init.headers.Authorization })
      return Response.json({ status: 1, data: [{ Workspace: { id: '456', name: 'Project', extra: 'hidden' } }] })
    },
  })
  await settings.get()
  await settings.save({ expectedRevision: 0, config: enabled, credentials: { mode: 'replace', token: 'saved-token' } })
  assert.equal(calls.length, 0, 'get and save never trigger discovery')
  const original = await credentials.readRecord(SETTINGS_KEY)
  const draft = await settings.discoverProjects({ auth: 'bearer', companyId: '987', nick: 'draft owner', credentials: { mode: 'replace', token: 'draft-token' } })
  assert.deepEqual(draft, { companyId: '987', scope: 'participant', projects: [{ id: '456', name: 'Project' }] })
  await settings.discoverProjects({ auth: 'bearer' })
  await settings.discoverProjects({ auth: 'bearer', credentials: { mode: 'use-refs' } })
  await settings.discoverProjects({ auth: 'basic' })
  assert.deepEqual(calls.map(call => call.header), [
    'Bearer draft-token', 'Bearer saved-token', 'Bearer host-token', `Basic ${Buffer.from('host-user:host-key').toString('base64')}`,
  ])
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), { company_id: '987', nick: 'draft owner' })
  assert.deepEqual(Object.fromEntries(calls[1].url.searchParams), { company_id: '123', nick: 'worker' })
  assert.deepEqual(Object.fromEntries(calls[3].url.searchParams), { company_id: '123', category: 'project' })
  await assert.rejects(settings.discoverProjects({ auth: 'basic', credentials: { mode: 'replace', token: 'mismatch' } }), { code: 'invalid-credentials' })
  assert.equal(calls.length, 4)
  assert.equal(writes, 1)
  assert.deepEqual(await credentials.readRecord(SETTINGS_KEY), original)
})

test('automatic bearer discovery disregards saved context and resolves draft, saved and host credentials without writing', async () => {
  const credentials = provider(new Map([['TAVLO_TAPD_TOKEN', 'host-token']]))
  const originalModify = credentials.modifyRecord
  let writes = 0
  credentials.modifyRecord = (...args) => { writes++; return originalModify(...args) }
  const calls = []
  const settings = await createSettings(credentials, { owner: 'profile owner' }, () => true, undefined, {
    fetchImpl: async (url, init) => {
      const { pathname, searchParams } = new URL(url)
      calls.push([pathname, Object.fromEntries(searchParams), init.headers.Authorization])
      return Response.json({ status: 1, data: pathname === '/users/info'
        ? { id: '1001', nick: 'current nick' }
        : [{ id: '456', name: 'Project' }] })
    },
  })
  const expected = { scope: 'participant', projects: [{ id: '456', name: 'Project' }], currentNick: 'current nick' }
  await assert.rejects(settings.discoverProjects({ auth: 'basic' }), { code: 'project-context-required' })
  assert.deepEqual(calls, [])
  assert.deepEqual(await settings.discoverProjects({ auth: 'bearer' }), expected)
  assert.equal(await credentials.readRecord(SETTINGS_KEY), undefined)
  await settings.save({ expectedRevision: 0, config: { ...enabled, companyId: '123', seedWorkspaceId: '88' },
    credentials: { mode: 'replace', token: 'saved-token' } })
  const original = await credentials.readRecord(SETTINGS_KEY)
  const auto = { auth: 'bearer', auto: true }
  assert.deepEqual(await settings.discoverProjects({ ...auto, credentials: { mode: 'replace', token: 'draft-token' } }), expected)
  assert.deepEqual(await settings.discoverProjects(auto), expected)
  assert.deepEqual(await settings.discoverProjects({ ...auto, credentials: { mode: 'use-refs' } }), expected)
  assert.deepEqual(calls, ['host-token', 'draft-token', 'saved-token', 'host-token'].flatMap(token => [
    ['/users/info', {}, `Bearer ${token}`],
    ['/workspaces/user_participant_projects', { nick: 'current nick' }, `Bearer ${token}`],
  ]))
  assert.equal(writes, 1)
  assert.deepEqual(await credentials.readRecord(SETTINGS_KEY), original)
  assert.equal(settings.snapshot().config.owner, 'worker')
})

test('project names use the effective saved credential on the read-only owner route', async () => {
  const credentials = provider()
  const calls = []
  const settings = await createSettings(credentials, {}, () => true, undefined, { fetchImpl: async (url, init) => {
    calls.push(new URL(url).pathname)
    assert.equal(init.headers.Authorization, 'Bearer saved-token')
    return Response.json({ status: 1, data: { Workspace: { id: '12345678', name: '真实项目名', description: 'not exposed' } } })
  } })
  await settings.save({ expectedRevision: 0, config: enabled, credentials: { mode: 'replace', token: 'saved-token' } })
  const before = await credentials.readRecord(SETTINGS_KEY)
  let route
  const dispose = mountSettings({ fetch: { register(next) { route = next; return async () => {} } } }, settings,
    () => assert.fail('discovery does not save'))
  async function rpc(input, signal) {
    const response = await route.fetch(new Request(`http://localhost${route.path}`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: SETTINGS_METHOD,
        payload: { operation: 'discover-project-names', input } }),
    }))
    assert.equal(response.headers.get('cache-control'), 'no-store')
    return (await response.json()).result
  }
  for (const input of [{ workspaceIds: [] }, { workspaceIds: ['1', '1'] }, { workspaceIds: ['https://example.invalid'] },
    { workspaceIds: Array.from({ length: 21 }, (_, i) => String(i)) }, { credentials: { mode: 'replace', token: 'draft' } }]) {
    assert.equal((await rpc({ auth: 'bearer', workspaceIds: ['12345678'], ...input })).error.code, 'tapd/bad-request')
  }
  const input = { auth: 'bearer', workspaceIds: ['12345678'] }
  assert.equal((await rpc(input, AbortSignal.abort())).error.code, 'tapd/aborted')
  assert.deepEqual(calls, [])
  assert.deepEqual(await rpc(input), { ok: true, value: { projects: [{ id: '12345678', name: '真实项目名' }] } })
  assert.deepEqual(calls, ['/workspaces/get_workspace_info'])
  assert.deepEqual(await credentials.readRecord(SETTINGS_KEY), before)
  await dispose()
})

test('explicit discovery RPCs use the owner route and redact errors, including rejection and permission failures', async () => {
  let route, saves = 0, status = 200, rejectStep
  const calls = []
  const identity = '/users/info', participant = '/workspaces/user_participant_projects'
  const settings = await createSettings(provider(), { companyId: '999' }, () => true, undefined, { fetchImpl: async (url, init) => {
    const path = new URL(url).pathname
    calls.push(path)
    assert.equal(init.headers.Authorization, 'Bearer draft-not-persisted')
    const failure = rejectStep?.path === path ? rejectStep.response : undefined
    if (failure instanceof Error) throw failure
    if (failure) return failure
    if (status !== 200) return Response.json({ message: 'hidden upstream body' }, { status })
    if (path === identity) return Response.json({ status: 1, data: { id: '1001', nick: 'nick' } })
    if (path === '/workspaces/get_workspace_info') return Response.json({ status: 1, data: { Workspace: { id: '88', company_id: 123 } } })
    if (path === participant) return Response.json({ status: 1, data: [] })
    return Response.json({ status: 1, data: { status: { options: { open: '未开始' } } } })
  } })
  const dispose = mountSettings({ fetch: { register(next) { route = next; return async () => {} } } }, settings, () => { saves++ })
  async function rpc(operation, input, signal) {
    const response = await route.fetch(new Request(`http://localhost${route.path}`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: SETTINGS_METHOD, payload: { operation, input } }),
    }))
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.json()
    assert.doesNotMatch(JSON.stringify(body), /draft-not-persisted|hidden upstream body/)
    return body.result
  }
  const credentials = { mode: 'replace', token: 'draft-not-persisted' }
  const projects = { auth: 'bearer', seedWorkspaceId: '88', nick: 'nick', credentials }
  const auto = { auth: 'bearer', auto: true, credentials }
  const scopes = { auth: 'bearer', workspaceId: '88', credentials }
  assert.equal((await rpc('discover-projects', { auth: 'bearer' })).error.code, 'tapd/project-context-required')
  assert.equal((await rpc('discover-projects', { ...projects, seedWorkspaceId: 'https://www.tapd.cn/88' })).error.code, 'tapd/bad-request')
  for (const mixed of [{ auth: 'basic' }, { auto: false }, { companyId: '123' }, { seedWorkspaceId: '123' },
    { nick: 'someone else' }, { path: 'https://example.invalid' }]) {
    assert.equal((await rpc('discover-projects', { ...auto, ...mixed })).error.code, 'tapd/bad-request')
  }
  assert.equal((await rpc('discover-projects', { ...auto, credentials: { mode: 'replace', apiUser: 'u', apiKey: 'k' } })).error.code,
    'tapd/invalid-credentials')
  assert.equal((await rpc('discover-statuses', { auth: 'basic', workspaceId: '88' })).error.code, 'tapd/invalid-credentials')
  const aborted = AbortSignal.abort(new Error('must not leak'))
  assert.equal((await rpc('discover-projects', projects, aborted)).error.code, 'tapd/aborted')
  assert.equal((await rpc('discover-projects', auto, aborted)).error.code, 'tapd/aborted')
  assert.deepEqual(calls, [])
  assert.deepEqual((await rpc('discover-projects', auto)).value, { scope: 'participant', projects: [], currentNick: 'nick' })
  assert.deepEqual(calls, [identity, participant])
  assert.deepEqual((await rpc('discover-projects', projects)).value, { companyId: '123', scope: 'participant', projects: [] })
  assert.deepEqual((await rpc('discover-statuses', scopes)).value, {
    stories: [{ key: 'open', label: '未开始' }], tasks: [{ key: 'open', label: '未开始' }],
  })
  status = 401
  assert.equal((await rpc('discover-statuses', scopes)).error.code, 'tapd/auth')
  status = 403
  assert.deepEqual(await rpc('discover-statuses', scopes), {
    ok: false, error: { code: 'tapd/discovery-forbidden', message: 'The selected TAPD credential does not have access to this metadata. You can enter the values manually.' },
  })
  status = 200
  const http = status => Response.json({ message: 'hidden upstream body' }, { status })
  const apiError = () => Response.json({ status: 0, info: 'hidden upstream body' })
  const option = { key: 'open', label: '未开始' }
  for (const [path, response, value] of [
    ['/stories/get_fields_info', http(403), { stories: [], tasks: [option], errors: { stories: 'tapd/discovery-forbidden' } }],
    ['/tasks/get_fields_info', apiError(), { stories: [option], tasks: [], errors: { tasks: 'tapd/api' }, standardTaskOptions: true }],
  ]) {
    rejectStep = { path, response }
    const firstCall = calls.length
    assert.deepEqual(await rpc('discover-statuses', scopes), { ok: true, value })
    assert.deepEqual(calls.slice(firstCall), ['/stories/get_fields_info', '/tasks/get_fields_info'])
  }
  const firstCall = calls.length
  for (const extra of [{ workspaceId: '88?workspace_id=1' }, { path: '/workitem_types' }, { system: 'bug' }]) {
    assert.equal((await rpc('discover-statuses', { ...scopes, ...extra })).error.code, 'tapd/bad-request')
  }
  assert.equal((await rpc('discover-statuses', scopes, aborted)).error.code, 'tapd/aborted')
  assert.equal(calls.length, firstCall)
  for (const [path, response, code, message] of [
    [identity, http(403), 'current-user-unavailable', /current-user nickname.*company ID/],
    [identity, http(404), 'current-user-unavailable', /current-user nickname/],
    [identity, apiError(), 'current-user-unavailable', /current-user nickname/],
    [identity, Response.json({ status: 1, data: { id: '1001', nick: 'hidden upstream body|invalid' } }),
      'current-user-unavailable', /current-user nickname/],
    [participant, http(400), 'project-context-required', /without a company context.*known project ID/],
    [participant, http(403), 'discovery-forbidden', /not permitted.*company context/],
    [participant, apiError(), 'api', /could not list.*known project ID/],
    [participant, Response.json({ status: 1, data: {} }), 'malformed', /usable participant project list/],
    [identity, http(500), 'http', /HTTP error/],
    ...[identity, participant].flatMap(path => [
      [path, http(401), 'auth', /rejected the supplied credentials/],
      [path, http(429), 'rate-limit', /rate limit/],
      [path, new TypeError('hidden upstream body'), 'network', /Could not reach TAPD/],
      [path, new DOMException('hidden upstream body', 'TimeoutError'), 'timeout', /timed out/],
    ]),
  ]) {
    rejectStep = { path, response }
    const firstCall = calls.length
    const { error } = await rpc('discover-projects', auto)
    assert.equal(error.code, `tapd/${code}`)
    assert.match(error.message, message)
    assert.deepEqual(calls.slice(firstCall), path === identity ? [identity] : [identity, participant])
  }
  rejectStep = { path: identity, response: http(403) }
  assert.equal((await rpc('discover-projects', auto)).error.code, 'tapd/current-user-unavailable')
  assert.deepEqual((await rpc('discover-projects', projects)).value, { companyId: '123', scope: 'participant', projects: [] })
  assert.equal(saves, 0)
  assert.equal((await settings.get()).configured, false)
  assert.equal((await settings.get()).revision, 0)
  await dispose()
})
