import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import { apply, Config } from '../index.js'
import { connectionLedger, parseConfig, resolveAuthorization, startPolling, tapdDomain } from '../runtime.js'

const active = { enabled: true, owner: ' li.user ', projects: [{ workspaceId: '12345678', stories: ['planning', 'planning'] }, { workspaceId: '87654321', tasks: ['open'] }] }

test('disabled by default; enabled always requires explicit project, owner, type and status', () => {
  assert.equal(parseConfig(Config({})), null)
  const config = parseConfig(Config(active))
  assert.equal(config.intervalSeconds, 300)
  assert.equal(config.maxNewPerScope, 25)
  assert.equal(config.lookbackDays, undefined)
  const rolling = parseConfig(Config({ ...active, lookbackDays: 30, companyId: '0012345' }))
  assert.equal(rolling.lookbackDays, 30)
  assert.equal(rolling.companyId, '0012345')
  assert.deepEqual(config.scopes, [
    { workspaceId: '12345678', objectType: 'story', owner: 'li.user', statuses: ['planning'] },
    { workspaceId: '87654321', objectType: 'task', owner: 'li.user', statuses: ['open'] },
  ])
  for (const bad of [
    { owner: '' }, { owner: 'li|xu' }, { owner: 'li>;USER_OR<xu' },
    { projects: [{ workspaceId: 123 }] }, { projects: [{ workspaceId: '123' }] },
    { projects: [...active.projects, active.projects[0]] }, { auth: 'auto' },
    { projects: [{ workspaceId: '123', stories: ['planning|done'] }] },
    { intervalSeconds: 0 }, { maxNewPerScope: 1001 }, { token: 'not-allowed' },
    { lookbackDays: 0 }, { lookbackDays: 366 }, { lookbackDays: 7.1 }, { companyId: 'TAPD' },
  ]) assert.throws(() => parseConfig({ ...active, ...bad }), /invalid-config|duplicate-project|missing-scopes/)
})

test('profile workspace mapping is optional and shared by stories and tasks without changing the TAPD ID', () => {
  const targetWorkspaceId = 'e56a5888-fca8-49fa-bdf6-4b51e9b2a502'
  const config = parseConfig(Config({ ...active, projects: [{ workspaceId: '123', targetWorkspaceId, stories: ['planning'], tasks: ['open'] }, active.projects[1]] }))
  assert.deepEqual(config.scopes.map(({ workspaceId, objectType, targetWorkspaceId }) => [workspaceId, objectType, targetWorkspaceId]),
    [['123', 'story', targetWorkspaceId], ['123', 'task', targetWorkspaceId], ['87654321', 'task', undefined]])
  assert.throws(() => parseConfig({ ...active, projects: [{ ...active.projects[0], targetWorkspaceId: 'bad' }] }), /invalid-config/)
})

test('credential resolution is explicit, refreshed and fails without leaking provider errors', async () => {
  const values = new Map([['TAVLO_TAPD_TOKEN', 'test-token'], ['TAVLO_TAPD_API_USER', 'api-user'], ['TAVLO_TAPD_API_KEY', 'my:key']])
  const seen = []
  const credentials = { async resolve(ref) { seen.push(ref); return { value: values.get(ref) } } }
  const bearer = parseConfig(active)
  assert.equal(await resolveAuthorization(credentials, bearer), 'Bearer test-token')
  values.set('TAVLO_TAPD_TOKEN', 'rotated.token')
  assert.equal(await resolveAuthorization(credentials, bearer), 'Bearer rotated.token')
  assert.deepEqual(seen, ['TAVLO_TAPD_TOKEN', 'TAVLO_TAPD_TOKEN'])
  assert.equal(await resolveAuthorization(credentials, parseConfig({ ...active, auth: 'basic' })), `Basic ${Buffer.from('api-user:my:key').toString('base64')}`)
  values.delete('TAVLO_TAPD_TOKEN')
  await assert.rejects(resolveAuthorization(credentials, bearer), { message: 'missing-credentials' })
  values.set('TAVLO_TAPD_TOKEN', 'bad\r\nsecret')
  await assert.rejects(resolveAuthorization(credentials, bearer), { message: 'invalid-credentials' })
  await assert.rejects(resolveAuthorization({ resolve() { throw new Error('private token echoed') } }, bearer), { message: 'credentials-unavailable' })
})

test('the disabled host still registers the settings dependency but does not poll', async () => {
  const messages = []
  const dependencies = []
  const ctx = {
    get(key) {
      if (key === 'logger') return { info: text => messages.push(text) }
      if (key === 'credentials') return { async readRecord() {}, resolve() { assert.fail('unexpected credential resolution') } }
      if (key === 'storageDomain') return { open() { assert.fail('unexpected sync storage access') } }
      assert.fail(`Unexpected service: ${key}`)
    },
    effect() {}, inject(keys) { dependencies.push(...keys) },
  }
  await apply(ctx, Config({}))
  assert.deepEqual(dependencies, ['connection', 'taskService'])
  assert.deepEqual(messages, ['tavlo-tapd: loaded; sync disabled (enabled=false)'])
})

test('domain ledger stores portable keys, reconnects to the same UUID, and rejects mismatched replay', async () => {
  assert.equal(tapdDomain.layout, 'per-record')
  let settings = {}
  const rows = new Map()
  const domain = {
    global: { get: () => settings, async set(value) { settings = value } },
    table(name) {
      assert.equal(name, 'imports')
      return { get size() { return rows.size }, get: key => rows.get(key), async put(key, value) { rows.set(key, value) } }
    },
  }
  const control = new AbortController()
  const state = await connectionLedger(domain, control.signal)
  const key = '12345678:story:1123456789000000123'
  const input = {
    requestId: 'tapd.test-1', title: 'Test', brief: 'Content', dueDate: '2028-02-29',
    workspaceId: 'e56a5888-fca8-49fa-bdf6-4b51e9b2a502',
    externalRef: { provider: 'tapd', connectionId: state.connectionId, scopeId: '12345678', objectType: 'story',
      objectId: '1123456789000000123', url: 'https://www.tapd.cn/12345678/prong/stories/view/1123456789000000123' },
  }
  await state.ledger.put(key, { kind: 'pending', input })
  assert.deepEqual([...rows.keys()], ['12345678-story-1123456789000000123'])
  const after = await connectionLedger(domain, control.signal)
  assert.equal(after.connectionId, state.connectionId)
  assert.deepEqual(after.ledger.get(key), { kind: 'pending', input })
  assert.throws(() => after.ledger.put('1234:story:1', { kind: 'pending', input }), /ledger-invalid/)
  await after.ledger.put(key, { kind: 'imported' })
  assert.deepEqual(rows.values().next().value, { kind: 'imported' })
  control.abort()
  assert.throws(() => after.ledger.put(key, { kind: 'imported' }), { name: 'AbortError' })
})

function virtualClock() {
  let time = 0
  const timers = new Map()
  return {
    timers,
    now: () => time,
    schedule(fn, delay) { const key = Symbol(); timers.set(key, { fn, at: time + delay }); return key },
    cancel(key) { timers.delete(key) },
    fire() {
      const [key, { fn, at }] = timers.entries().next().value
      timers.delete(key)
      time = at
      fn()
    },
  }
}

test('rounds never overlap, Retry-After is honored, and stop aborts/drains the round', async () => {
  const clock = virtualClock()
  const runs = []
  const errors = []
  const stop = startPolling({ ...clock, intervalMs: 300_000,
    run: signal => new Promise(resolve => runs.push({ signal, resolve })), onError: error => errors.push(error) })
  assert.equal(clock.timers.size, 1)
  clock.fire()
  assert.equal(runs.length, 1)
  assert.equal(clock.timers.size, 0)
  runs[0].resolve({ retryAfterMs: 600_000 })
  await setImmediate()
  assert.equal(clock.timers.values().next().value.at, 600_000)
  clock.fire()
  assert.equal(runs.length, 2)
  const draining = stop()
  assert(runs[1].signal.aborted)
  assert.strictEqual(draining, stop())
  runs[1].resolve({})
  await draining
  assert.equal(clock.timers.size, 0)
  assert.deepEqual(errors, [])
})
