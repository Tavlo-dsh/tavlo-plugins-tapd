import assert from 'node:assert/strict'
import { test } from 'node:test'
import { syncRound } from '../sync.js'

const connectionId = 'd9a3f5de-af75-4153-bb21-20b66a67dfd4'
const scope = { workspaceId: '100', objectType: 'story', owner: 'owner-private', statuses: ['open'] }
const taskScope = { ...scope, objectType: 'task' }
const thirdScope = { ...scope, workspaceId: '200' }
const makeRow = (id, overrides) => ({
  id, title: `Original ${id}`, description: `Description ${id}`,
  url: `https://www.tapd.cn/100/prong/stories/view/${id}`, ...overrides,
})
const key = (id, s = scope) => `${s.workspaceId}:${s.objectType}:${id}`
const identity = (id, s = scope) => ({
  provider: 'tapd', connectionId, scopeId: s.workspaceId, objectType: s.objectType, objectId: id,
})
const ok = value => ({ ok: true, value })
const errorResult = (code, reason) => ({ ok: false, error: { code, message: 'private task error', details: { reason } } })
const scanError = (code, rest) => Object.assign(new Error('private upstream body'), { code, ...rest })
const capabilities = () => ({
  contractVersion: 1, operations: ['create', 'list', 'update', 'launch', 'set-stage'],
  features: { externalRef: true, externalRefUnique: true, filteredList: true },
  limits: { maxTitleLength: 200, maxBriefLength: 20000 },
})

function fixture(initialRows = [makeRow('1')]) {
  const f = {
    live: new Map(), receipts: new Map(), records: new Map(),
    reports: [], calls: [], scans: [], puts: [], caps: capabilities(), rows: initialRows,
  }
  const isExact = (a, b) => !!a && !!b && Object.keys(b).every(field => a[field] === b[field])
  const tasks = {
    async capabilities() { return structuredClone(f.caps) },
    async execute(op, input, signal) {
      assert.ok(op === 'create' || op === 'list', `Unexpected operation: ${op}`)
      f.calls.push({ op, input: structuredClone(input), signal })
      const override = await f.interceptTask?.(op, input)
      if (override) return override
      if (op === 'list') {
        const { externalRef, limit } = input
        assert.deepEqual(Object.keys(input).sort(), ['externalRef', 'limit'])
        assert.deepEqual(Object.keys(externalRef).sort(), Object.keys(identity('1')).sort())
        return ok({ tasks: [...f.live.values()].filter(task => isExact(task.externalRef, externalRef)).slice(0, limit) })
      }
      if (f.receipts.has(input.requestId)) {
        assert.deepEqual(input, f.receipts.get(input.requestId))
        const task = f.live.get(input.requestId)
        return task ? ok({ task }) : errorResult('tasks/deleted')
      }
      const existing = [...f.live.values()].find(task => isExact(task.externalRef, identity(input.externalRef.objectId, {
        workspaceId: input.externalRef.scopeId, objectType: input.externalRef.objectType,
      })))
      if (existing) return errorResult('tasks/external-conflict', 'duplicate')
      f.receipts.set(input.requestId, structuredClone(input))
      const task = { ...structuredClone(input), id: input.requestId, stage: 'todo' }
      f.live.set(task.id, task)
      return ok({ task })
    },
  }
  const ledger = {
    async get(k) { return structuredClone(f.records.get(k)) },
    async put(k, record) {
      f.puts.push({ k, record: structuredClone(record) })
      await f.beforePut?.(k, record)
      f.records.set(k, structuredClone(record))
      await f.afterPut?.(k, record)
    },
  }
  f.run = options => syncRound({
    tasks, ledger, connectionId, scopes: [scope], maxNewPerScope: 10, authorization: 'private authorization',
    async scan(args) {
      f.scans.push(args)
      return f.scan ? f.scan(args) : f.rows
    },
    report: event => f.reports.push(event), ...options,
  })
  f.creates = () => f.calls.filter(call => call.op === 'create').map(call => call.input)
  return f
}

test('dedupes exact external identities independent of URL, and never follows remote edits, local edits, deletion or unbinding', async () => {
  const f = fixture([makeRow('1'), makeRow('2'), makeRow('3'), makeRow('1')])
  f.live.set('preexisting', { id: 'preexisting', externalRef: { ...identity('2'), url: 'https://www.tapd.cn/old' } })
  const signal = new AbortController().signal
  assert.deepEqual(await f.run({ signal }), {})
  assert.deepEqual(f.scans[0], { ...scope, authorization: 'private authorization', signal })
  assert.ok(f.calls.every(call => call.signal === signal))
  assert.equal(f.creates().length, 2)
  assert.deepEqual([1, 2, 3].map(id => f.records.get(key(id))), Array(3).fill({ kind: 'imported' }))
  assert.deepEqual(f.reports[0], {
    workspaceId: '100', objectType: 'story', code: 'ok', scanned: 4, candidates: 2,
    created: 2, duplicates: 2, suppressed: 0, failed: 0,
  })

  f.rows = f.rows.map(row => ({ ...row, title: 'Updated remotely', url: `${row.url}?changed=1` }))
  const [first, third] = f.creates()
  const edited = f.live.get(first.requestId)
  edited.title = 'Edited locally'
  delete f.live.get(third.requestId).externalRef
  f.live.delete('preexisting')
  const doneCalls = f.calls.length
  await f.run()
  assert.equal(f.calls.length, doneCalls, 'the ledger suppresses even a deleted or unbound task')
  assert.equal(edited.title, 'Edited locally')
  assert.equal(f.reports.at(-1).duplicates, 4)
})

test('new items follow the mapping, missing targets do not generate ungrouped cards, and replays keep their original target', async () => {
  const a = 'e56a5888-fca8-49fa-bdf6-4b51e9b2a502'
  const b = 'db5b65e1-62b5-44ac-a3dd-b46cafad93f0'
  const f = fixture()
  const mapped = id => ({ ...scope, targetWorkspaceId: id })
  const hasWorkspace = id => id === a || id === b
  await f.run({ scopes: [mapped(a)], hasWorkspace: () => false })
  assert.equal(f.reports.at(-1).code, 'workspace-unavailable')
  assert.equal(f.records.size, 0)
  assert.equal(f.creates().length, 0)
  assert.equal(f.scans[0].targetWorkspaceId, undefined, 'local workspace ID is not sent to TAPD')
  f.interceptTask = op => { if (op === 'create') throw new Error('uncertain write') }
  await f.run({ scopes: [mapped(a)], hasWorkspace })
  const original = f.creates()[0]
  assert.equal(original.workspaceId, a)
  assert.equal(original.externalRef.scopeId, '100')
  f.interceptTask = undefined
  f.rows.push(makeRow('2'))
  await f.run({ scopes: [mapped(b)], hasWorkspace })
  assert.deepEqual(f.creates()[1], original)
  assert.equal(f.creates()[2].workspaceId, b)
  await f.run({ scopes: [scope], hasWorkspace })
  assert.equal(f.creates().length, 3, 'mapping edits do not re-import existing cards')
})

test('prepares a bounded literal description, preserves a clickable source link, and omits invalid optional dates', async () => {
  const hostilePlainText = '![img](https://evil.example/i) <https://evil.example/>\n```\nmore'
  const f = fixture([
    makeRow('1', { title: '票😀🛠', description: hostilePlainText.repeat(5), dueDate: '2028-02-29' }),
    makeRow('2', { title: '   ', dueDate: '2026-02-30' }),
  ])
  f.caps.limits = { maxTitleLength: 2, maxBriefLength: 157 }
  await f.run()
  const [first, second] = f.creates()
  assert.equal(first.title, '票')
  assert.equal(second.title, 'TA')
  assert.match(first.requestId, /^tapd\.[0-9a-f-]{36}$/)
  assert.deepEqual(Object.keys(first).sort(), ['brief', 'dueDate', 'externalRef', 'requestId', 'title'])
  assert.equal(first.dueDate, '2028-02-29')
  assert.equal(second.dueDate, undefined)
  const [link, blankLine, ...description] = first.brief.split('\n')
  assert.equal(link, `[Open in TAPD](<${first.externalRef.url}>)`)
  assert.equal(blankLine, '')
  assert.ok(description.join('\n').includes('![img]'))
  assert.ok(description.every(line => line.startsWith('    ')), 'untrusted markup remains literal inside Markdown code')
  assert.ok(first.brief.length <= f.caps.limits.maxBriefLength)

  const tight = fixture()
  tight.caps.limits.maxBriefLength = tight.rows[0].url.length + 2
  await tight.run()
  assert.equal(tight.creates()[0].brief, `<${tight.rows[0].url}>`)
})

test('reuses the whole pending input after ledger and create uncertainties, only while the identity still scans', async () => {
  const f = fixture()
  f.afterPut = (_k, record) => {
    if (record.kind === 'pending') throw new Error('private post-write storage failure')
  }
  await f.run()
  assert.equal(f.creates().length, 0, 'an uncertain ledger write must never proceed to create in that round')
  const input = f.records.get(key('1')).input
  assert.equal(f.reports.at(-1).code, 'ledger-failed')
  f.afterPut = undefined
  f.interceptTask = op => { if (op === 'create') throw new Error('private transport failure') }
  f.rows = [makeRow('1', { title: 'Changed', description: 'Changed', dueDate: '2028-01-01', url: 'https://www.tapd.cn/changed' })]
  await f.run()
  assert.deepEqual(f.creates(), [input])
  assert.deepEqual(f.records.get(key('1')), { kind: 'pending', input })
  f.rows = []
  await f.run()
  assert.deepEqual(f.creates(), [input], 'no replay while the remote item is out of scope')
  f.rows = [makeRow('1', { title: 'Changed again' })]
  f.interceptTask = undefined
  await f.run()
  assert.deepEqual(f.creates(), [input, input])
  assert.deepEqual(f.records.get(key('1')), { kind: 'imported' })
  assert.equal(f.puts.filter(({ record }) => record.kind === 'pending').length, 1)
})

test('reconciles confirmed duplicate races but does not mark other external conflicts', async () => {
  const f = fixture([makeRow('1'), makeRow('2'), makeRow('3')])
  f.interceptTask = (op, input) => {
    if (op !== 'create') return
    if (input.externalRef.objectId === '1') {
      f.live.set('other-creator', { id: 'other-creator', externalRef: { ...identity('1'), url: input.externalRef.url } })
      return // TaskService detects the now-occupied identity inside create.
    }
    if (input.externalRef.objectId === '2') return errorResult('tasks/external-conflict', 'rebind-required')
    return errorResult('tasks/external-conflict', undefined)
  }
  await f.run()
  assert.deepEqual(f.records.get(key('1')), { kind: 'imported' })
  assert.equal(f.records.get(key('2')).kind, 'pending')
  assert.equal(f.records.get(key('3')).kind, 'pending')
  assert.equal(f.reports[0].code, 'task-failed')
  assert.equal(f.reports[0].duplicates, 1)
  assert.equal(f.reports[0].failed, 2)
})

test('recovers after the final ledger write fails, even if the task was subsequently deleted or unbound', async () => {
  const f = fixture([makeRow('1'), makeRow('2'), makeRow('3')])
  f.beforePut = (_k, record) => {
    if (record.kind === 'imported') throw new Error('private disk error')
  }
  await f.run()
  const originals = f.creates()
  assert.equal(f.reports[0].created, 3)
  assert.equal(f.reports[0].failed, 3)
  f.beforePut = undefined
  f.live.delete(originals[0].requestId)
  delete f.live.get(originals[1].requestId).externalRef
  await f.run()
  assert.deepEqual(f.creates(), [...originals, ...originals.slice(0, 2)])
  assert.deepEqual([1, 2, 3].map(id => f.records.get(key(id))), Array(3).fill({ kind: 'imported' }))
  assert.equal(f.live.size, 2)
  assert.equal(f.reports[1].duplicates, 1)
  assert.equal(f.reports[1].suppressed, 2)
  assert.equal(f.reports[1].created, 0)
})

test('plans the whole scan before a write, and an oversized scope writes neither pending retries nor existing markers', async () => {
  const f = fixture()
  f.records.set(key('1'), { kind: 'pending', input: {
    requestId: 'tapd.previous', title: 'Already planned', brief: '', externalRef: { ...identity('1'), url: makeRow('1').url },
  } })
  f.live.set('existing', { id: 'existing', externalRef: identity('2') })
  f.scan = s => s.objectType === 'story' ? [makeRow('1'), makeRow('2'), makeRow('3')] : [makeRow('1')]
  await f.run({ scopes: [scope, taskScope], maxNewPerScope: 1 })
  assert.equal(f.reports[0].code, 'scope-limit')
  assert.equal(f.reports[0].candidates, 2)
  assert.equal(f.reports[0].scanned, 3)
  assert.deepEqual(f.puts.map(({ k }) => k), [key('1', taskScope), key('1', taskScope)])
  assert.deepEqual(f.creates().map(input => input.externalRef.objectType), ['task'])
  assert.equal(f.records.get(key('1')).kind, 'pending')
  const lastStoryList = f.calls.findLastIndex(({ op, input }) => op === 'list' && input.externalRef.objectType === 'story')
  assert.equal(lastStoryList, 2, 'the scan was fully planned before comparing the cap')
})

test('scoped scan failures are safely reported and do not prevent a later scope from succeeding', async () => {
  for (const [failure, code] of [
    [scanError('tapd/auth', { status: 401 }), 'auth'],
    [scanError('tapd/timeout'), 'timeout'],
    [scanError('tapd/scan-limit'), 'scan-limit'],
    [scanError('private unknown code', { status: 500 }), 'scan-failed'],
  ]) {
    const f = fixture()
    f.scan = s => { if (s.objectType === 'story') throw failure; return [makeRow('1')] }
    await f.run({ scopes: [scope, taskScope] })
    assert.deepEqual(f.reports.map(r => r.code), [code, 'ok'])
    assert.equal(f.reports[0].scanned, 0)
    assert.equal(f.reports[0].failed, 1)
    assert.equal(f.reports[1].created, 1)
    assert.ok(f.puts.every(({ k }) => k === key('1', taskScope)))
    assert.doesNotMatch(JSON.stringify(f.reports), /private|owner|authorization|https?:/)
  }
})

test('fails closed on incomplete planning and preserves earlier writes on a separate partial create failure', async () => {
  const f = fixture([makeRow('1'), makeRow('2'), makeRow('3')])
  f.live.set('match', { id: 'match', externalRef: identity('1') })
  f.interceptTask = (op, input) => {
    if (op === 'list' && input.externalRef.objectId === '2') return errorResult('tasks/unavailable')
  }
  await f.run()
  assert.equal(f.puts.length, 0, 'no marker for the earlier exact match until planning completes')
  assert.equal(f.reports[0].code, 'task-failed')
  f.interceptTask = (op, input) => {
    if (op === 'create' && input.externalRef.objectId === '2') return errorResult('tasks/persistence-unknown')
  }
  await f.run()
  assert.deepEqual(f.records.get(key('1')), { kind: 'imported' })
  assert.equal(f.records.get(key('2')).kind, 'pending')
  assert.deepEqual(f.records.get(key('3')), { kind: 'imported' })
  assert.equal(f.reports[1].created, 1)
  assert.equal(f.reports[1].failed, 1)
  assert.equal(f.reports[1].code, 'task-write-unknown')
})

test('reports TaskService capacity without replacing the pending request', async () => {
  const f = fixture()
  f.interceptTask = op => op === 'create' ? errorResult('tasks/limit-reached') : undefined
  await f.run()
  assert.equal(f.reports[0].code, 'task-capacity')
  assert.equal(f.reports[0].failed, 1)
  assert.deepEqual(f.records.get(key('1')), { kind: 'pending', input: f.creates()[0] })
  assert.doesNotMatch(JSON.stringify(f.reports), /private/)
})

test('a 429 stops the whole round, honors zero and uses a floor for missing Retry-After', async () => {
  for (const [retryAfterMs, expected] of [[12_345, 12_345], [0, 0], [undefined, 60_000]]) {
    const f = fixture()
    f.scan = s => {
      if (s.objectType === 'task') throw scanError('tapd/rate-limit', { status: 429, retryAfterMs })
      return [makeRow('1')]
    }
    assert.deepEqual(await f.run({ scopes: [scope, taskScope, thirdScope] }), { retryAfterMs: expected })
    assert.equal(f.scans.length, 2)
    assert.deepEqual(f.reports.map(r => r.code), ['ok', 'rate-limit'])
    assert.equal(f.creates().length, 1)
    assert.equal(f.records.size, 1)
  }
})

test('aborting after a pending write prevents create and all subsequent writes', async () => {
  const f = fixture([makeRow('1'), makeRow('2')])
  const abort = new AbortController()
  f.afterPut = () => abort.abort('private abort reason')
  assert.deepEqual(await f.run({ scopes: [scope, taskScope], signal: abort.signal }), {})
  assert.equal(f.puts.length, 1)
  assert.equal(f.records.get(key('1')).kind, 'pending')
  assert.equal(f.creates().length, 0)
  assert.equal(f.scans.length, 1)
  assert.equal(f.reports[0].code, 'aborted')
  assert.doesNotMatch(JSON.stringify(f.reports), /private/)
})

test('checks the TaskService contract, operations and all required features before scanning', async () => {
  for (const override of [
    { contractVersion: 2 }, { operations: ['create'] }, { operations: ['list'] },
    ...['externalRef', 'externalRefUnique', 'filteredList'].map(feature => ({
      features: { ...capabilities().features, [feature]: false },
    })),
  ]) {
    const f = fixture()
    Object.assign(f.caps, override)
    assert.deepEqual(await f.run(), {})
    assert.equal(f.reports[0].code, 'unsupported-tasks')
    assert.equal(f.scans.length, 0)
    assert.equal(f.calls.length, 0)
    assert.equal(f.puts.length, 0)
  }
})
