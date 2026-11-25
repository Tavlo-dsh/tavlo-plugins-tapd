import assert from 'node:assert/strict'
import test from 'node:test'
import { discoverProjectNames, discoverProjects, discoverStatuses } from '../metadata.js'

const success = data => Response.json({ status: 1, data })
const project = (id, name) => ({ Workspace: { id, name, description: 'not projected' } })
const fields = options => ({ status: { options, pure_options: ['not projected'] }, label: { options: ['not projected'] } })
const authorization = 'Bearer test-token'

function checkRequest(resource, init, path, params, auth = authorization) {
  const url = new URL(resource)
  assert.equal(url.origin, 'https://api.tapd.cn')
  assert.equal(url.pathname, path)
  assert.deepEqual(Object.fromEntries(url.searchParams), params)
  assert.equal(init.method, 'GET')
  assert.equal(init.headers.Authorization, auth)
  assert.equal(init.redirect, 'error')
  assert.equal(init.credentials, 'omit')
  assert.ok(init.signal instanceof AbortSignal)
}

test('known project IDs resolve names without listing or a nickname, and inaccessible projects do not hide the rest', async () => {
  const requested = []
  const ids = ['1010104801000128627', '88', '89', '90', '91']
  const result = await discoverProjectNames({ workspaceIds: ids, authorization, fetchImpl: async (url, init) => {
    const id = new URL(url).searchParams.get('workspace_id')
    requested.push(id)
    checkRequest(url, init, '/workspaces/get_workspace_info', { workspace_id: id })
    if (id === '88') return new Response(null, { status: 403 })
    if (id === '89') return success(project('100', 'Wrong project'))
    if (id === '90') return success(project(id, 'Invalid\nname'))
    return success(project(id === '91' ? 91 : id, ' TAPD 项目名称 '))
  } })
  assert.deepEqual(requested, ids)
  assert.deepEqual(result.projects.sort((a, b) => a.id.localeCompare(b.id)), [
    { id: ids[0], name: 'TAPD 项目名称' }, { id: '91', name: 'TAPD 项目名称' },
  ])
})

test('PAT project listing uses documented participant context and projects only IDs and names', async () => {
  const input = { auth: 'bearer', companyId: '123', nick: '李 + & Dev', authorization }
  const result = await discoverProjects({ ...input, fetchImpl: async (url, init) => {
    checkRequest(url, init, '/workspaces/user_participant_projects', { company_id: '123', nick: input.nick })
    return success([project('1010104801000128627', ' Team '), project(8, '工程'), project('8', '工程')])
  } })
  assert.deepEqual(result, {
    projects: [{ id: '1010104801000128627', name: 'Team' }, { id: '8', name: '工程' }], companyId: '123', scope: 'participant',
  })
})

test('no-context PAT discovery uses its validated current identity and returns only actual projects', async () => {
  const paths = []
  const result = await discoverProjects({ auth: 'bearer', nick: 'Saved owner', authorization, fetchImpl: async (url, init) => {
    const { pathname, search } = new URL(url)
    paths.push(pathname)
    if (pathname === '/users/info') {
      checkRequest(url, init, pathname, {})
      assert.equal(search, '')
      return success({ id: '1001', nick: ' 李 + & Dev ', extra: 'not projected' })
    }
    checkRequest(url, init, '/workspaces/user_participant_projects', { nick: '李 + & Dev' })
    return success([
      { Workspace: { id: '1', category: 'organization' } },
      { category: 'organization' },
      { category: 'organization', Workspace: { id: 2, name: ' organization ', category: 'project', company_id: '99' } },
      { id: '0123', name: 'Flat', company_id: '98' },
      project('2', 'organization'),
    ])
  } })
  assert.deepEqual(paths, ['/users/info', '/workspaces/user_participant_projects'])
  assert.deepEqual(result, {
    scope: 'participant', projects: [{ id: '2', name: 'organization' }, { id: '0123', name: 'Flat' }], currentNick: '李 + & Dev',
  })
})

test('auto lists are bounded and only complete valid projections are returned', async () => {
  const identity = { id: '1001', nick: 'worker' }
  const list = data => discoverProjects({ auth: 'bearer', auto: true, authorization, fetchImpl: async url =>
    success(new URL(url).pathname === '/users/info' ? identity : data) })
  const rows = Array.from({ length: 500 }, (_, i) => ({ id: i + 1, name: `Project ${i + 1}` }))
  const result = await list([...rows, { id: 'not read', name: '' }])
  assert.equal(result.projects.length, 500)
  assert.deepEqual(result.projects[499], { id: '500', name: 'Project 500' })
  assert.equal(result.truncated, true)
  assert.deepEqual(await list([]), { scope: 'participant', projects: [], currentNick: 'worker' })
  for (const data of [{}, [project('1', 'Valid'), { id: 9007199254740992, name: 'Unsafe' }],
    [project('1', 'First'), { id: '1', name: 'Contradiction' }], [{ id: '1', name: 'Invalid', Workspace: null }]]) {
    await assert.rejects(list(data), { code: 'tapd/malformed' })
  }
})

test('invalid current-user nicknames stop discovery before the participant list request', async () => {
  for (const nick of [undefined, null, 1, ' ', 'a<b', 'a|b', 'a;b', 'a,b', 'a\nb', 'a\u2028b', 'a'.repeat(129)]) {
    let calls = 0
    await assert.rejects(discoverProjects({ auth: 'bearer', auto: true, authorization, fetchImpl: async (url, init) => {
      calls++
      checkRequest(url, init, '/users/info', {})
      return success({ id: '1001', nick })
    } }), { code: 'tapd/current-user-unavailable' })
    assert.equal(calls, 1)
  }
})

test('cancellation reaches the pending participant list after identity lookup', async () => {
  const abort = new AbortController()
  const { promise, resolve } = Promise.withResolvers()
  const discovery = discoverProjects({ auth: 'bearer', authorization, signal: abort.signal, fetchImpl: async (url, init) => {
    if (new URL(url).pathname === '/users/info') return success({ id: '1001', nick: 'worker' })
    resolve(init.signal)
    return new Promise(() => {})
  } })
  const signal = await promise
  abort.abort(new Error('private abort reason'))
  await assert.rejects(discovery, { code: 'tapd/aborted' })
  assert.equal(signal.aborted, true)
})

test('Basic company catalog is not personal and is labeled when capped, with no speculative pagination', async () => {
  let calls = 0
  const header = 'Basic dXNlcjpwYXNz'
  const result = await discoverProjects({ auth: 'basic', companyId: '321', nick: 'ignored', authorization: header, fetchImpl: async (url, init) => {
    calls++
    checkRequest(url, init, '/workspaces/projects', { company_id: '321', category: 'project' }, header)
    return success(Array.from({ length: 510 }, (_, i) => project(String(i + 1), `Project ${i}`)))
  } })
  assert.equal(calls, 1)
  assert.equal(result.scope, 'company')
  assert.equal(result.companyId, '321')
  assert.equal(result.projects.length, 500)
  assert.equal(result.truncated, true)
})

test('a seed workspace must match and provide a valid company ID before listing', async () => {
  const header = 'Basic dXNlcjpwYXNz'
  const input = { auth: 'basic', seedWorkspaceId: '12345', authorization: header }
  let calls = 0
  const result = await discoverProjects({ ...input, fetchImpl: async (url, init) => {
    if (++calls === 1) {
      checkRequest(url, init, '/workspaces/get_workspace_info', { workspace_id: '12345' }, header)
      return success({ Workspace: { id: 12345, company_id: 67890, name: 'Not projected' } })
    }
    checkRequest(url, init, '/workspaces/projects', { company_id: '67890', category: 'project' }, header)
    return success([])
  } })
  assert.deepEqual(result, { projects: [], companyId: '67890', scope: 'company' })
  assert.equal(calls, 2)
  for (const workspace of [{ id: '12346', company_id: '67890' }, { id: '12345', company_id: 9007199254740992 }]) {
    calls = 0
    await assert.rejects(discoverProjects({ ...input, fetchImpl: async () => {
      calls++
      return success({ Workspace: workspace })
    } }), { code: 'tapd/malformed' })
    assert.equal(calls, 1)
  }
})

test('a malformed project response or invalid project does not report partial success', async () => {
  for (const data of [{ Workspace: [] }, [project('1', 'Valid'), project(9007199254740992, 'Unsafe')],
    [project('1', 'First'), project('1', 'Contradiction')], [project('1', '')]]) {
    await assert.rejects(discoverProjects({ auth: 'basic', companyId: '1', authorization, fetchImpl: async () => success(data) }),
      { code: 'tapd/malformed' })
  }
})

test('per-project status discovery reads the two official definitions, not item lists', async () => {
  const paths = []
  const result = await discoverStatuses({ workspaceId: '303', authorization, fetchImpl: async (url, init) => {
    const path = new URL(url).pathname
    paths.push(path)
    checkRequest(url, init, path, { workspace_id: '303' })
    return success(path === '/stories/get_fields_info' ? fields({ planning: '规划中', status_21: '自定义' }) : fields({ open: '未开始' }))
  } })
  assert.deepEqual(paths.sort(), ['/stories/get_fields_info', '/tasks/get_fields_info'])
  assert.deepEqual(result, { stories: [{ key: 'planning', label: '规划中' }, { key: 'status_21', label: '自定义' }], tasks: [{ key: 'open', label: '未开始' }] })
})

const statusInput = { workspaceId: '303', authorization }
const forbidden = () => Response.json({ message: authorization }, { status: 403 })
const storyType = (id, workspace = '303', entity = 'story') => ({
  WorkitemType: { id, workspace_id: workspace, entity_type: entity, name: 'not projected' },
})
const storiesPath = '/stories/get_fields_info'
const tasksPath = '/tasks/get_fields_info'
const typesPath = '/workitem_types'
const mapPath = '/workflows/status_map'

test('denying one type does not abort a slower sibling or trigger a fallback', async () => {
  const { promise, resolve } = Promise.withResolvers()
  const paths = []
  let siblingSignal
  const result = discoverStatuses({ ...statusInput, fetchImpl: async (url, init) => {
    const path = new URL(url).pathname
    paths.push(path)
    if (path === storiesPath) return forbidden()
    assert.equal(path, tasksPath)
    siblingSignal = init.signal
    return promise
  } })
  await new Promise(setImmediate)
  assert.equal(siblingSignal.aborted, false)
  resolve(success(fields({ open: 'Open' })))
  assert.deepEqual(await result, { stories: [], tasks: [{ key: 'open', label: 'Open' }], errors: { stories: 'tapd/discovery-forbidden' } })
  assert.deepEqual(paths, [storiesPath, tasksPath])
})

test('unreadable task statuses return per-type errors and precisely gate documented fallback choices', async () => {
  const oversized = Object.fromEntries(Array.from({ length: 513 }, (_, i) => [`status_${i}`, 'Label']))
  for (const [response, code, fallback] of [
    [() => success({}), 'tapd/malformed', true], [() => success(fields([])), 'tapd/malformed', true],
    [() => success(fields({ 'bad|key': 'bad' })), 'tapd/malformed', true],
    [() => success(fields({ open: 'x'.repeat(1025) })), 'tapd/malformed', true],
    [() => success(fields(oversized)), 'tapd/discovery-limit'],
    [forbidden, 'tapd/discovery-forbidden'],
    [() => Response.json({ status: 0, info: authorization }), 'tapd/api', true],
    [() => Response.json({}, { status: 400 }), 'tapd/http', true],
    [() => Response.json({}, { status: 404 }), 'tapd/http', true],
    [() => Response.json({}, { status: 500 }), 'tapd/http'],
    [() => Response.json({}, { status: 401 }), 'tapd/auth'],
    [() => Response.json({}, { status: 429 }), 'tapd/rate-limit'],
  ]) {
    const paths = []
    const result = await discoverStatuses({ ...statusInput, fetchImpl: async url => {
      const path = new URL(url).pathname
      paths.push(path)
      return path === storiesPath ? success(fields({ accepted: 'Accepted' })) : response()
    } })
    assert.deepEqual(result, { stories: [{ key: 'accepted', label: 'Accepted' }], tasks: [], errors: { tasks: code },
      ...(fallback ? { standardTaskOptions: true } : {}) })
    assert.deepEqual(paths, [storiesPath, tasksPath])
  }
})

test('unavailable story field options fall back to the documented category-specific workflow status maps', async () => {
  for (const primary of [() => success(fields([])), () => Response.json({ message: authorization }, { status: 404 })]) {
    const paths = []
    const result = await discoverStatuses({ ...statusInput, fetchImpl: async (url, init) => {
      const { pathname, searchParams } = new URL(url)
      paths.push(pathname)
      const workspace = { workspace_id: '303' }
      if (pathname === storiesPath || pathname === tasksPath) {
        checkRequest(url, init, pathname, workspace)
        return pathname === storiesPath ? primary() : success(fields({ open: 'Open' }))
      }
      if (pathname === typesPath) {
        checkRequest(url, init, pathname, { ...workspace, entity_type: 'story', fields: 'id,workspace_id,entity_type', limit: '9', page: '1' })
        return success([storyType(7), storyType('7'), storyType('1010104801000321043')])
      }
      const id = searchParams.get('workitem_type_id')
      checkRequest(url, init, mapPath, { ...workspace, system: 'story', workitem_type_id: id })
      assert.ok(['7', '1010104801000321043'].includes(id))
      return success(id === '7' ? { planning: ' 规划中 ', status_12: '开发中' } : { planning: '规划中', status_22: '自定义' })
    } })
    assert.deepEqual(result, {
      stories: [{ key: 'planning', label: '规划中' }, { key: 'status_12', label: '开发中' }, { key: 'status_22', label: '自定义' }],
      tasks: [{ key: 'open', label: 'Open' }],
    })
    assert.deepEqual(paths, [storiesPath, tasksPath, typesPath, mapPath, mapPath])
  }
})

test('workflow fallback is bounded, validates category scope, and never returns an incomplete story list', async () => {
  const catalog = [storyType('7'), storyType('8')]
  const maps = start => Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`status_${start + i}`, 'Label']))
  for (const [types, workflow, code, count] of [
    [[storyType('7+1')], null, 'tapd/malformed', 0],
    [[storyType('7', '404')], null, 'tapd/malformed', 0],
    [[storyType('7', '303', 'bug')], null, 'tapd/malformed', 0],
    [Array.from({ length: 9 }, (_, i) => storyType(i + 1)), null, 'tapd/discovery-limit', 0],
    [catalog, id => id === '7' ? success({ planning: 'Planning' }) : forbidden(), 'tapd/discovery-forbidden', 2],
    [catalog, id => success({ planning: `Different labels for ${id}` }), 'tapd/malformed', 2],
    [catalog, id => success(maps(id === '7' ? 0 : 257)), 'tapd/discovery-limit', 2],
    [catalog, () => success([{ Status: { key: 'arbitrary', label: 'Label' } }]), 'tapd/malformed', 1],
  ]) {
    const paths = []
    const result = await discoverStatuses({ ...statusInput, fetchImpl: async url => {
      const { pathname, searchParams } = new URL(url)
      paths.push(pathname)
      if (pathname === storiesPath) return success({ unrelated: { options: { invented: 'Do not use' } } })
      if (pathname === tasksPath) return success(fields({ open: 'Open' }))
      if (pathname === typesPath) return success(types)
      assert.equal(pathname, mapPath)
      return workflow(searchParams.get('workitem_type_id'))
    } })
    assert.deepEqual(result, { stories: [], tasks: [{ key: 'open', label: 'Open' }], errors: { stories: code } })
    assert.deepEqual(paths, [storiesPath, tasksPath, typesPath, ...Array(count).fill(mapPath)])
  }
})

test('all-failed discovery retains the safe error and story API denial does not trigger extra reads', async () => {
  const paths = []
  await assert.rejects(discoverStatuses({ ...statusInput, fetchImpl: async url => {
    paths.push(new URL(url).pathname)
    return forbidden()
  } }), { code: 'tapd/auth', status: 403, message: 'TAPD authentication failed.' })
  assert.deepEqual(paths, [storiesPath, tasksPath])
  paths.length = 0
  assert.deepEqual(await discoverStatuses({ ...statusInput, fetchImpl: async url => {
    const path = new URL(url).pathname
    paths.push(path)
    return path === storiesPath ? Response.json({ status: 0, info: authorization }) : success(fields({}))
  } }), { stories: [], tasks: [], errors: { stories: 'tapd/api' } })
  assert.deepEqual(paths, [storiesPath, tasksPath])
})

test('invalid workspace IDs and caller abort stop discovery, including halfway through fallback', async () => {
  const noFetch = async () => assert.fail('No endpoint should be called')
  for (const workspaceId of ['303&system=bug', 'x'.repeat(33), 303, undefined]) {
    await assert.rejects(discoverStatuses({ ...statusInput, workspaceId, fetchImpl: noFetch }), { code: 'tapd/invalid-input' })
  }
  await assert.rejects(discoverStatuses({ ...statusInput, signal: AbortSignal.abort(), fetchImpl: noFetch }), { code: 'tapd/aborted' })
  const abort = new AbortController()
  const { promise, resolve } = Promise.withResolvers()
  const paths = []
  const result = discoverStatuses({ ...statusInput, signal: abort.signal, fetchImpl: async (url, init) => {
    const path = new URL(url).pathname
    paths.push(path)
    if (path === storiesPath) return success({})
    if (path === tasksPath) return success(fields({ open: 'Open' }))
    assert.equal(path, typesPath)
    resolve(init.signal)
    return new Promise(() => {})
  } })
  const requestSignal = await promise
  abort.abort(new Error('sensitive abort'))
  await assert.rejects(result, { code: 'tapd/aborted', message: 'TAPD scan was cancelled.' })
  assert.equal(requestSignal.aborted, true)
  assert.deepEqual(paths, [storiesPath, tasksPath, typesPath])
})
