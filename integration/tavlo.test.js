// Workspace-only integration: the sibling Tavlo tasks checkout is required.
import assert from 'node:assert/strict'
import { setTimeout } from 'node:timers/promises'
import test from 'node:test'
import { mountHost, mountStorage } from '../../tavlo-plugins-tasks/tests/fixtures.mjs'
import { createTaskService } from '../../tavlo-plugins-tasks/task-service.js'
import { openTaskStorage } from '../../tavlo-plugins-tasks/task-storage.js'
import { createTaskStore } from '../../tavlo-plugins-tasks/task-store.js'
import * as bridge from '../index.js'
import { tapdDomain } from '../runtime.js'

const limits = { maxTitleLength: 200, maxBriefLength: 20000, maxTasks: 10000 }
const project = '12345678', item = '1123456789000000001', user = 'integration-owner'
const config = { enabled: true, owner: user, projects: [{ workspaceId: project, stories: ['planning'] }] }
const success = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }

async function until(predicate) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const result = await predicate()
    if (result) return result
    await setTimeout(15)
  }
  assert.fail('Timed out waiting for bridge integration result')
}

test('real Cordis Host bridge journals into real TaskService and does not recreate deleted tasks after restart', { timeout: 10000 }, async t => {
  const host = await mountStorage(t)
  const { ctx, own, storageRoot } = host
  ctx.provide('dshHomePath', (...parts) => [storageRoot, ...parts].join('/'))
  ctx.provide('credentials', { async resolve(ref) { assert.equal(ref, 'TAVLO_TAPD_TOKEN'); return { value: 'integration-only' } } })
  const calls = []
  const originalFetch = globalThis.fetch
  let title = 'TAPD 原始标题'
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    const parsed = new URL(url)
    assert.equal(parsed.origin, 'https://api.tapd.cn')
    assert.equal(parsed.pathname, '/stories')
    assert.equal(parsed.searchParams.get('workspace_id'), project)
    assert.equal(init.headers.Authorization, 'Bearer integration-only')
    assert.equal(init.method, 'GET')
    return Response.json({ status: 1, data: [{ Story: {
      id: item, workspace_id: project, name: title, owner: `${user};`, status: 'planning',
      description: '<p>任务说明<img src="https://example.invalid/1"></p>', due: '2026-11-27',
    } }] })
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const first = own(ctx.plugin(bridge, config))
  await first.await()
  assert.equal(calls.length, 0, 'no TaskService, no API request')
  const board = own(ctx.plugin({ inject: ['storage', 'storageDomain'], async apply(ctx) {
    let store
    await ctx.effect(async () => {
      const domain = await openTaskStorage(ctx, {})
      store = createTaskStore(domain, limits)
      return () => store.close()
    })
    ctx.provide('taskService', createTaskService(store))
  } }))
  await board.await()
  const service = ctx.get('taskService')
  const list = async () => success(await service.execute('list', { provider: 'tapd' })).tasks
  const created = await until(async () => (await list())[0])
  assert.equal(created.title, title)
  assert.equal(created.stage, 'todo')
  assert.equal(created.dueDate, '2026-11-27')
  assert.equal(created.externalRef.objectId, item)
  assert.match(created.brief, /Open in TAPD/)
  assert.doesNotMatch(created.brief, /example\.invalid/)
  const facility = ctx.get('storageDomain')
  await until(() => !facility.get(tapdDomain.name))
  await first.dispose()

  const edited = success(await service.execute('update', {
    taskId: created.id, requestId: 'local-edit', expectedRevision: created.revision, patch: { title: '本地修改' },
  })).task
  title = 'TAPD 改标题'
  const second = own(ctx.plugin(bridge, config))
  await second.await()
  await until(() => calls.length === 2 && !facility.get(tapdDomain.name))
  assert.deepEqual(await list(), [edited])
  await second.dispose()

  success(await service.execute('delete', { taskId: edited.id, expectedRevision: edited.revision }))
  const third = own(ctx.plugin(bridge, config))
  await third.await()
  await until(() => calls.length === 3 && !facility.get(tapdDomain.name))
  assert.deepEqual(await list(), [])
  await third.dispose()
})

test('real owner RPC can save config and start the existing importer without restarting the Host', { timeout: 10000 }, async t => {
  const host = await mountHost(t)
  const workspace = { id: 'e56a5888-fca8-49fa-bdf6-4b51e9b2a502', title: 'Integration workspace', path: 'C:/fixture' }
  host.ctx.provide('workspaceRegistry', { list: () => [workspace], get: id => id === workspace.id ? workspace : undefined })
  const row = host.own(host.ctx.plugin(bridge))
  await row.await()
  const originalFetch = globalThis.fetch
  let scans = 0, degradedStatuses = false
  const discovery = []
  globalThis.fetch = async (url, init) => {
    const target = new URL(url)
    if (target.origin === host.origin) return originalFetch(url, init)
    assert.equal(target.origin, 'https://api.tapd.cn')
    assert.equal(init.headers.Authorization, 'Bearer integration-token')
    assert.equal(init.method, 'GET')
    assert.equal(init.redirect, 'error')
    assert.equal(init.credentials, 'omit')
    const result = data => Response.json({ status: 1, data })
    if (target.pathname !== '/stories') discovery.push([target.pathname, Object.fromEntries(target.searchParams)])
    if (target.pathname === '/users/info') {
      assert.equal(target.search, '')
      return result({ id: '90001', nick: user, privateField: 'not projected' })
    }
    if (target.pathname === '/workspaces/user_participant_projects') {
      const row = { id: project, name: 'TAPD 项目' }
      return result(target.searchParams.has('company_id') ? [{ Workspace: row }] : [row, { category: 'organization' }])
    }
    assert.equal(target.searchParams.get('workspace_id'), project)
    if (target.pathname === '/workspaces/get_workspace_info') return result({ Workspace: { id: project, company_id: 98765 } })
    if (target.pathname === '/stories/get_fields_info') return result({ status: { options: degradedStatuses ? [] : { planning: '规划中' } } })
    if (target.pathname === '/tasks/get_fields_info') {
      if (degradedStatuses) return Response.json({ info: 'private TAPD details' }, { status: 403 })
      return result({ status: { options: { open: '未开始' } } })
    }
    if (target.pathname === '/workitem_types') return result([{ WorkitemType: { id: '123', workspace_id: project, entity_type: 'story' } }])
    if (target.pathname === '/workflows/status_map') return result({ planning: '规划中' })
    assert.equal(target.pathname, '/stories')
    ++scans
    const [from, to] = target.searchParams.get('modified').split('~')
    assert.equal(Date.parse(to.replace(' ', 'T') + '+08:00') - Date.parse(from.replace(' ', 'T') + '+08:00'), 7 * 86_400_000)
    const story = { id: item, name: '从界面配置导入', workspace_id: project,
      owner: user, status: 'planning', description: 'mock only' }
    return result([{ Story: { ...story, modified: to } }, { Story: { ...story, id: '1234', modified: '2000-01-01 00:00:00' } }])
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const method = 'tavlo-tapd/settings'
  const path = `/api/${method}`
  const invoke = (operation, input) => host.rpc.call('/api', method, { operation, input })
  assert.equal((await originalFetch(host.origin + path, { method: 'POST' })).status, 401)
  assert.equal((await host.fetchAuthenticated(path, { method: 'POST', headers: { origin: 'https://untrusted.example' } })).status, 403)
  const guest = host.ctx.get('connection').createPeer({ principal: { kind: 'probe-guest' } })
  t.after(() => guest.dispose())
  const api = host.ctx.get('connection').createSharedFetchHandler('/api')
  assert.equal((await api.fetch(new Request(host.origin + path, { method: 'POST' }), guest)).status, 403)
  const initial = success(await invoke('get', {}))
  assert.equal(initial.syncState, 'disabled')
  assert.deepEqual(initial.workspaces, [workspace])
  const credentials = { mode: 'replace', token: 'integration-token' }
  const auto = success(await invoke('discover-projects', { auth: 'bearer', auto: true, credentials }))
  assert.deepEqual(auto, { scope: 'participant', projects: [{ id: project, name: 'TAPD 项目' }], currentNick: user })
  assert.deepEqual(discovery, [
    ['/users/info', {}], ['/workspaces/user_participant_projects', { nick: user }],
  ])
  const found = success(await invoke('discover-projects', { auth: 'bearer', nick: user, seedWorkspaceId: project, credentials }))
  assert.deepEqual(found, { companyId: '98765', scope: 'participant', projects: [{ id: project, name: 'TAPD 项目' }] })
  assert.deepEqual(discovery.slice(2), [
    ['/workspaces/get_workspace_info', { workspace_id: project }],
    ['/workspaces/user_participant_projects', { company_id: '98765', nick: user }],
  ])
  const statuses = success(await invoke('discover-statuses', { auth: 'bearer', workspaceId: project, credentials }))
  assert.deepEqual(statuses, { stories: [{ key: 'planning', label: '规划中' }], tasks: [{ key: 'open', label: '未开始' }] })
  assert.deepEqual(discovery.slice(4).sort(), [
    ['/stories/get_fields_info', { workspace_id: project }], ['/tasks/get_fields_info', { workspace_id: project }],
  ])
  degradedStatuses = true
  const partial = success(await invoke('discover-statuses', { auth: 'bearer', workspaceId: project, credentials }))
  assert.deepEqual(partial, { stories: statuses.stories, tasks: [], errors: { tasks: 'tapd/discovery-forbidden' } })
  assert.deepEqual(discovery.slice(6), [
    ['/stories/get_fields_info', { workspace_id: project }], ['/tasks/get_fields_info', { workspace_id: project }],
    ['/workitem_types', { workspace_id: project, entity_type: 'story', fields: 'id,workspace_id,entity_type', limit: '9', page: '1' }],
    ['/workflows/status_map', { workspace_id: project, system: 'story', workitem_type_id: '123' }],
  ])
  assert.equal(scans, 0, 'discovery does not start or persist the importer')
  const unchanged = success(await invoke('get', {}))
  assert.equal(unchanged.revision, 0)
  assert.equal(unchanged.configured, false)
  const active = { ...config, auth: 'bearer', intervalSeconds: 300, maxNewPerScope: 25,
    companyId: found.companyId, lookbackDays: 7,
    projects: [{ ...config.projects[0], tasks: [], targetWorkspaceId: workspace.id }] }
  const saved = success(await invoke('save', { expectedRevision: 0, config: active, credentials }))
  assert.equal(saved.credentialSource, 'visual')
  assert.equal(saved.syncState, 'ready')
  assert.doesNotMatch(JSON.stringify(saved), /integration-token/)
  const tasks = host.ctx.get('taskService')
  const card = await until(async () => success(await tasks.execute('list', { provider: 'tapd' })).tasks[0])
  assert.equal(card.workspaceId, workspace.id)
  assert.equal(card.externalRef.scopeId, project)
  assert.equal(success(await tasks.execute('list', { workspaceId: workspace.id })).tasks.length, 1)
  assert.equal(scans, 1)
  const paused = success(await invoke('save', { expectedRevision: 1, config: { ...active, enabled: false } }))
  assert.equal(paused.syncState, 'disabled')
  assert.equal(paused.configured, true)
  assert.equal(scans, 1)
})
