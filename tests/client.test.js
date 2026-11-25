import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const packageName = '@tavlo-dsh/dsh-plugin-tapd'
const slot = 'plugins.bundle.config'
const exactId = '00090071992547409931234567890123'
const seedId = '00123'
const seedLink = `https://www.tapd.cn/${seedId}/`
const firstWorkspace = { id: 'd0921ecf-62e1-4f47-9ccf-dde5b720b6d4', title: 'Operations', path: 'F:/work/operations' }
const secondWorkspace = { id: '8b0ea114-564d-4d1c-a60f-3c6a5d181ddb', title: 'Client', path: 'F:/work/client' }
const missingWorkspaceId = '2d5730e3-7459-43b7-9f0e-8728f2f691ee'
const config = {
  enabled: true, auth: 'bearer', owner: 'Tavlo', projects: [{ workspaceId: exactId, stories: ['open', 'planning'], tasks: ['progressing'] }],
  intervalSeconds: 300, maxNewPerScope: 25,
}
const ok = (overrides = {}) => ({
  ok: true,
  value: {
    revision: 3, source: 'profile', config, configured: true, credentialSource: 'refs', syncState: 'waiting-for-board',
    workspaceStatus: 'ready', workspaces: [firstWorkspace, secondWorkspace], ...overrides,
  },
})
const reject = code => ({ ok: false, error: { code: `tapd/${code}`, message: 'message must not render: sensitive-token-placeholder' } })
const saved = (input, overrides = {}) => ok({ revision: input.expectedRevision + 1, source: 'visual', config: input.config, ...overrides })
const discovered = (projects, extra = {}) => ({ ok: true, value: { scope: 'participant', projects, ...extra } })
const statuses = (stories = [], tasks = [], extra = {}) => ({
  ok: true, value: { stories: stories.map(([key, label]) => ({ key, label })), tasks: tasks.map(([key, label]) => ({ key, label })), ...extra },
})
const json = value => JSON.parse(JSON.stringify(value))
const flat = tree => tree == null || typeof tree === 'boolean' ? [] : Array.isArray(tree) ? tree.flatMap(flat)
  : typeof tree === 'object' ? [tree, ...flat(tree.children)] : [tree]
const visible = tree => Array.isArray(tree) ? tree.map(visible) : !tree || typeof tree !== 'object' ? tree : tree.props.hidden ? null : {
  ...tree, children: visible(tree.type === 'details' && !tree.props.open ? tree.children.filter(node => node?.type === 'summary') : tree.children),
}
const htmlText = tree => flat(tree).filter(node => typeof node === 'string').join(' ')
const controls = (tree, type) => flat(tree).filter(node => node.type === type)
const withRole = (tree, role) => flat(tree).filter(node => node.props?.role === role)
const field = (tree, type, key) => controls(tree, type).find(node => node.props.id?.endsWith(`-${key}`))
const input = (tree, key) => field(tree, 'input', key)
const select = (tree, key) => field(tree, 'select', key)
const projectRows = tree => withRole(tree, 'group')
const projectIds = tree => projectRows(tree).map(row => input(row, 'workspaceId').props.value)
const chooser = row => withRole(row, 'combobox').find(node => node.props.id.endsWith('-chooser'))
const projectOptions = row => withRole(visible(row), 'option')
const projectOption = (row, id) => projectOptions(row).find(node => node.props['data-project-id'] === id)
const statusGroup = (row, label) => controls(row, 'fieldset').find(group => htmlText(controls(group, 'legend')[0]) === label)
const statusToggle = (row, label) => controls(row, 'label').find(node => htmlText(node) === label)?.children.find(node => node.type === 'input' && node.props.type === 'checkbox')
const step = (tree, key) => controls(tree, 'section').find(node => node.props['aria-labelledby']?.endsWith(`-${key}-title`))
const refsReset = tree => controls(tree, 'input').find(node => node.props['aria-describedby']?.endsWith('refs-hint'))
const button = (tree, text) => controls(tree, 'button').find(node => htmlText(node) === text)
const click = node => {
  assert.equal(typeof node?.props.onClick, 'function', 'Expected a clickable control')
  assert(!node.props.disabled && !node.props['aria-disabled'], 'Expected an enabled control')
  return node.props.onClick()
}
const press = (node, key) => {
  let prevented = false
  node.props.onKeyDown({ key, preventDefault() { prevented = true } })
  assert(prevented, `Expected ${key} to stay within the project picker`)
}
const update = (node, value) => {
  assert.equal(typeof node?.props.onChange, 'function', 'Expected an editable control')
  return node.props.onChange({ currentTarget: { value, checked: value === true } })
}
const submit = tree => {
  let prevented = false
  const result = controls(tree, 'form')[0].props.onSubmit({ preventDefault() { prevented = true } })
  assert(prevented)
  return result
}

// Mount the loader entry, execute apply and render the component returned by the actual slot.
// The scoped synchronous React shim keeps these package tests dependency-free.
function setup(handler, lang = 'en', lookupNames = () => discovered([])) {
  let cursor = 0
  let effects = []
  const rootHooks = []
  const pickerHooks = new Map()
  let hooks = rootHooks
  const same = (a, b) => a.length === b?.length && a.every((item, i) => Object.is(item, b[i]))
  let unmounted = false
  let staleWrites = 0
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props?.role === 'option' && type === 'li'
      ? { ...props, 'data-project-id': props.id?.match(/-options-([0-9]+)$/)?.[1] } : props ?? {}, children }),
    useId: () => `tapd-test-${cursor++}`,
    useRef(value) { return hooks[cursor++] ??= { current: value } },
    useState(value) {
      const i = cursor++
      const state = hooks[i] ??= { value }
      return [state.value, next => {
        if (unmounted) staleWrites++
        state.value = typeof next === 'function' ? next(state.value) : next
      }]
    },
    useEffect(effect, deps) {
      const i = cursor++
      const previous = hooks[i]
      if (!same(deps, previous?.deps)) {
        const next = { deps }
        hooks[i] = next
        effects.push(() => { previous?.cleanup?.(); next.cleanup = effect() })
      }
    },
    useCallback(callback, deps) {
      const i = cursor++
      const previous = hooks[i]
      if (same(deps, previous?.deps)) return previous.callback
      hooks[i] = { deps, callback }
      return callback
    },
  }
  const calls = [], nameCalls = []
  let plugin
  let registration
  let injected
  let dictionaries
  let locale
  let forbiddenAccesses = 0
  const forbidden = () => { forbiddenAccesses++; throw Error('The TAPD UI must not access browser storage or log secrets') }
  // Exercise the settings logic against the UIArc adapter’s public props without a DOM.
  const arcs = {
    Input: ({ children, ...props }) => React.createElement('input', props),
    Select: ({ children, choices, onChange, ...props }) => React.createElement('select', {
      ...props, onChange: event => onChange(event.currentTarget.value),
    }, choices.map(([value, label, disabled]) => React.createElement('option', { value, disabled }, label))),
    Disclosure: ({ title, annotation, defaultOpen, children }) => React.createElement('details', { open: defaultOpen },
      React.createElement('summary', null, title, annotation), children),
    ArcStyle: () => React.createElement('style', { 'data-tavlo-tapd-arc-styles': '' }),
  }
  const window = { __ModuleLoader__: { load({ id, factory }) {
    assert.equal(id, packageName)
    assert.equal(plugin, undefined)
    plugin = factory(dependency => {
      if (dependency === 'react') return React
      assert.equal(dependency, './ui/arcs')
      return arcs
    })
  } } }
  const sandbox = { AbortController, URL, window }
  for (const target of [window, sandbox]) {
    for (const key of ['localStorage', 'sessionStorage', 'console']) Object.defineProperty(target, key, { get: forbidden })
  }
  runInNewContext(source, sandbox, { filename: 'tavlo-plugins-tapd/client.js' })
  assert.deepEqual(json(plugin.inject), ['slots', 'locale', 'connection'])
  plugin.apply({
    effect: callback => callback(),
    locale: { register(namespace, values) { locale = namespace; dictionaries = values; return () => {} } },
    slots: {
      inject(name, callback) { assert.equal(name, slot); injected = callback },
      register(descriptor, render) { assert.equal(registration, undefined); registration = { descriptor, render } },
    },
    connection: { rpc: { call(channel, method, body, signal) {
      assert.deepEqual([channel, method], ['/api', 'tavlo-tapd/settings'])
      const payload = json(body)
      if (payload.operation === 'discover-project-names') {
        assert(signal instanceof AbortSignal)
        nameCalls.push({ input: payload.input, signal })
        return Promise.resolve(lookupNames(payload.input, signal))
      }
      assert.equal(signal, undefined)
      calls.push(payload)
      return handler(payload)
    } } },
    get logger() { return forbidden() },
  })
  assert.equal(registration, undefined)
  injected()
  assert.deepEqual(json(registration.descriptor), { name: slot, key: packageName, locale })
  assert.deepEqual(Object.keys(dictionaries).sort(), ['en', 'zh'])
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.zh).sort())
  const t = (key, attrs = {}) => {
    const localized = dictionaries[lang][key]
    assert.equal(typeof localized, 'string', `Missing ${lang} translation: ${key}`)
    return localized.replace(/\{(\w+)\}/g, (_, param) => String(attrs[param]))
  }
  assert.equal(registration.render({ view: 'summary', t }), null)
  assert.deepEqual(calls, [])
  const cleanup = frame => { for (const hook of frame) hook?.cleanup?.() }
  const render = () => {
    const mountedPickers = new Set()
    const expand = node => {
      if (node == null || typeof node !== 'object') return node
      if (Array.isArray(node)) return node.map(expand)
      if (typeof node.type !== 'function') return { ...node, children: node.children.map(expand) }
      const props = { ...node.props, children: node.children }
      // Keep each picker’s search, focus and active option independent. A new key remounts it.
      if (node.type.name !== 'ProjectPicker') return expand(node.type(props))
      const instance = `${props.id}:${props.key}`
      mountedPickers.add(instance)
      if (!pickerHooks.has(instance)) pickerHooks.set(instance, [])
      const parentCursor = cursor
      cursor = 0
      hooks = pickerHooks.get(instance)
      const picker = node.type(props)
      hooks = rootHooks
      cursor = parentCursor
      return expand(picker)
    }
    cursor = 0
    const tree = expand(registration.render({ view: 'page', t }))
    for (const [instance, frame] of pickerHooks) {
      if (!mountedPickers.has(instance)) { cleanup(frame); pickerHooks.delete(instance) }
    }
    const queued = effects
    effects = []
    for (const effect of queued) effect()
    assert.equal(forbiddenAccesses, 0)
    return tree
  }
  return {
    calls, nameCalls, render, staleWrites: () => staleWrites,
    async load() { render(); await setImmediate(); return render() },
    unmount() { unmounted = true; cleanup(rootHooks); for (const frame of pickerHooks.values()) cleanup(frame) },
  }
}

test('registers only the bundle page and loads existing Host values in both languages', async () => {
  let finish
  const client = setup(() => new Promise(resolve => { finish = resolve }))
  assert.match(htmlText(client.render()), /Loading TAPD settings/)
  assert.deepEqual(client.calls, [{ operation: 'get', input: {} }])
  finish(ok({ credentials: { token: 'not-a-public-value' } }))
  await setImmediate()
  const tree = client.render()
  const defaultView = visible(tree)
  assert.match(htmlText(defaultView), /Sync status.*Waiting for the Tavlo task board.*TAPD connection Host credential references/)
  assert.match(htmlText(defaultView), /Existing tasks aren’t moved, and pending imports keep their original destination/)
  assert(!select(defaultView, 'auth'))
  assert(!input(defaultView, 'token'))
  assert(!input(defaultView, 'intervalSeconds'))
  assert(!refsReset(tree))
  assert.equal(input(tree, 'owner').props.value, 'Tavlo')
  assert.equal(input(tree, 'workspaceId').props.type, 'text')
  assert.equal(input(tree, 'workspaceId').props.value, exactId)
  assert.match(htmlText(projectRows(defaultView)[0]), /Story statuses: 2.*Task statuses: 1/)
  assert(!input(tree, 'stories'))
  assert(!input(tree, 'tasks'))
  assert.doesNotMatch(htmlText(projectRows(defaultView)[0]), /\b(?:open|planning|progressing)\b/)
  assert.equal(input(tree, 'token').props.value, '')
  assert.equal(input(tree, 'token').props.autoComplete, 'new-password')
  assert.equal(input(tree, 'intervalSeconds').props.value, '300')
  assert.equal(input(tree, 'maxNewPerScope').props.value, '25')
  const sync = button(defaultView, 'Enable TAPD sync')
  assert.equal(sync.props.role, 'switch')
  assert.equal(sync.props['aria-checked'], true)
  sync.props.onClick()
  assert.equal(button(client.render(), 'Enable TAPD sync').props['aria-checked'], false)
  assert.equal(client.calls.length, 1)
  assert(!htmlText(tree).includes('not-a-public-value'))
  for (const control of [...controls(tree, 'input'), ...controls(tree, 'select')].filter(node => node.props.id)) {
    assert(controls(tree, 'label').some(label => label.props.htmlFor === control.props.id))
  }
  const chinese = setup(() => ok({ configured: false, credentialSource: 'none', syncState: 'disabled' }), 'zh')
  const chineseView = visible(await chinese.load())
  assert.match(htmlText(chineseView), /TAPD 同步设置.*同步状态.*未启用.*01 连接 TAPD.*尚未配置凭据.*02 选择同步项目.*03 设置同步范围/)
  assert.match(htmlText(chineseView), /DSH 工作区 未分组/)
  assert(select(chineseView, 'auth'))
  assert(input(chineseView, 'token'))
  assert(!input(chineseView, 'intervalSeconds'))
  assert(!refsReset(chineseView))
})

test('shows a saved project name and never resolves a typed ID before it is committed', async () => {
  const calls = []
  const client = setup(() => ok(), 'en', () => new Promise(resolve => calls.push(resolve)))
  await client.load()
  assert.deepEqual(client.nameCalls[0].input, { auth: 'bearer', workspaceIds: [exactId] })
  calls[0](discovered([{ id: exactId, name: 'Saved project title' }]))
  await setImmediate()
  assert.equal(htmlText(controls(projectRows(client.render())[0], 'h4')[0]), 'Saved project title')
  update(input(client.render(), 'workspaceId'), '88')
  assert.doesNotMatch(htmlText(projectRows(client.render())[0]), /Saved project title/)
  assert.equal(client.nameCalls.length, 1)
  input(client.render(), 'workspaceId').props.onBlur({ currentTarget: { value: '88' } })
  client.render()
  assert.deepEqual(client.nameCalls[1].input, { auth: 'bearer', workspaceIds: ['88'] })
  update(input(client.render(), 'token'), 'new-unsaved-token')
  client.render()
  assert.equal(client.nameCalls[1].signal.aborted, true)
  calls[1](discovered([{ id: '88', name: 'Stale title' }]))
  await setImmediate()
  assert.doesNotMatch(htmlText(client.render()), /Stale title/)
  assert.equal(client.nameCalls.length, 2)
})

test('saves checked status keys and ranges while leaving the exact project ID and credentials alone', async () => {
  const client = setup(({ operation, input }) => {
    if (operation === 'get') return ok()
    if (operation === 'discover-statuses') return statuses([
      ['open', 'Open'], ['planning', 'Planning'], ['reopened', 'Reopened'], ['review', 'Ready for review'],
    ], [['progressing', 'In progress'], ['done', 'Done']])
    assert.equal(operation, 'save')
    return saved(input, { syncState: 'ready' })
  })
  const row = () => projectRows(client.render())[0]
  await client.load()
  await click(button(row(), 'Load status options'))
  assert.deepEqual(client.calls[1], { operation: 'discover-statuses', input: { auth: 'bearer', workspaceId: exactId } })
  assert.equal(statusToggle(row(), 'Open').props.checked, true)
  assert.equal(statusToggle(row(), 'Planning').props.checked, true)
  assert.equal(statusToggle(row(), 'Reopened').props.checked, false)
  assert.equal(statusToggle(row(), 'In progress').props.checked, true)
  assert.equal(statusToggle(row(), 'Done').props.checked, false)
  update(statusToggle(row(), 'Planning'), false)
  update(statusToggle(row(), 'Reopened'), true)
  update(statusToggle(row(), 'Ready for review'), true)
  update(statusToggle(row(), 'Done'), true)
  assert.match(htmlText(row()), /Story statuses: 3.*Task statuses: 2/)
  assert.doesNotMatch(htmlText(row()), /\bprogressing\b/)
  const tree = client.render()
  update(input(tree, 'intervalSeconds'), '86400')
  update(input(tree, 'maxNewPerScope'), '1')
  assert.equal(client.calls.length, 2)
  await submit(client.render())
  assert.deepEqual(client.calls[2], { operation: 'save', input: { expectedRevision: 3, config: {
    ...config,
    projects: [{ workspaceId: exactId, stories: ['open', 'reopened', 'review'], tasks: ['progressing', 'done'] }],
    intervalSeconds: 86400, maxNewPerScope: 1,
  } } })
  assert.match(htmlText(visible(client.render())), /Task board connected.*TAPD settings saved\./)
})

test('shows registered workspaces per project and saves only explicit mappings and status keys', async () => {
  const hostConfig = { ...config, projects: [{ ...config.projects[0], targetWorkspaceId: firstWorkspace.id }] }
  const workspace = { ...secondWorkspace, title: firstWorkspace.title }
  const workspaces = [firstWorkspace, workspace]
  const client = setup(({ operation, input }) => operation === 'get' ? ok({ config: hostConfig, workspaces }) : saved(input, { workspaces }))
  let tree = await client.load()
  const target = select(tree, 'targetWorkspaceId')
  assert.equal(target.props.value, firstWorkspace.id)
  assert.deepEqual(controls(target, 'option').map(option => [option.props.value, htmlText(option)]), [
    ['', 'Ungrouped'], [firstWorkspace.id, 'Operations — F:/work/operations'], [workspace.id, 'Operations — F:/work/client'],
  ])
  update(target, workspace.id)
  button(tree, 'Add manually').props.onClick()
  tree = client.render()
  const project = flat(tree).filter(node => node.props?.role === 'group')[1]
  assert.equal(select(project, 'targetWorkspaceId').props.value, '')
  assert.match(htmlText(project), /No statuses selected/)
  assert.equal(button(project, 'Load status options').props.disabled, true)
  assert.equal(chooser(project), undefined)
  update(input(project, 'workspaceId'), '42')
  assert.equal(client.calls.length, 1)
  await submit(client.render())
  assert.deepEqual(client.calls[1].input.config.projects, [
    { ...config.projects[0], targetWorkspaceId: workspace.id }, { workspaceId: '42', stories: [], tasks: [] },
  ])
  assert.equal(client.calls[1].input.config.intervalSeconds, config.intervalSeconds)
  assert.equal(client.calls[1].input.config.maxNewPerScope, config.maxNewPerScope)
  update(select(client.render(), 'targetWorkspaceId'), '')
  await submit(client.render())
  assert.deepEqual(client.calls[2].input.config.projects[0], config.projects[0])
})

test('retains a deleted target, warns imports are paused, and cannot assign it to a different project', async () => {
  const hostConfig = { ...config, projects: [{ ...config.projects[0], targetWorkspaceId: missingWorkspaceId }] }
  const client = setup(({ operation, input }) => operation === 'get' ? ok({ config: hostConfig, workspaces: [] }) : saved(input, { workspaces: [] }))
  let tree = await client.load()
  const target = select(tree, 'targetWorkspaceId')
  assert.equal(target.props.value, missingWorkspaceId)
  const deadChoice = controls(target, 'option').find(option => option.props.value === missingWorkspaceId)
  assert.equal(deadChoice.props.disabled, true)
  assert.match(htmlText(deadChoice), /Missing workspace/)
  const hintId = target.props['aria-describedby'].split(' ')[0]
  const hint = flat(tree).find(node => node.props?.id === hintId)
  assert.match(htmlText(hint), /New imports for this project are paused/)
  update(input(tree, 'owner'), 'Updated assignee')
  await submit(client.render())
  assert.equal(client.calls[1].input.config.projects[0].targetWorkspaceId, missingWorkspaceId)
  tree = client.render()
  update(input(tree, 'workspaceId'), '42')
  submit(client.render())
  assert.equal(client.calls.length, 2)
  assert.match(htmlText(client.render()), /selected destination can’t be assigned/)
  update(select(client.render(), 'targetWorkspaceId'), '')
  await submit(client.render())
  assert.deepEqual(client.calls[2].input.config.projects[0], { ...config.projects[0], workspaceId: '42' })
  assert.match(htmlText(client.render()), /No DSH workspaces are registered/)
})

test('unavailable and legacy workspace responses preserve saved targets and offer no new mappings', async () => {
  for (const catalog of [{ workspaceStatus: 'unavailable' }, { workspaceStatus: undefined, workspaces: undefined }]) {
    const hostConfig = { ...config, projects: [{ ...config.projects[0], targetWorkspaceId: firstWorkspace.id }] }
    const client = setup(({ operation, input }) => operation === 'get' ? ok({ config: hostConfig, ...catalog }) : saved(input, catalog))
    let tree = await client.load()
    assert.match(htmlText(tree), /DSH workspace list is unavailable/)
    assert.doesNotMatch(htmlText(tree), /Missing workspace|are paused/)
    let target = select(tree, 'targetWorkspaceId')
    assert.equal(target.props.value, firstWorkspace.id)
    assert.equal(target.props.disabled, false)
    assert.deepEqual(controls(target, 'option').map(option => option.props.value), ['', firstWorkspace.id])
    assert.match(htmlText(target), /Saved workspace/)
    button(tree, 'Add manually').props.onClick()
    tree = client.render()
    const newProject = flat(tree).filter(node => node.props?.role === 'group')[1]
    target = select(newProject, 'targetWorkspaceId')
    assert.equal(target.props.disabled, true)
    assert.deepEqual(controls(target, 'option').map(option => option.props.value), [''])
    update(input(newProject, 'workspaceId'), '42')
    await submit(client.render())
    assert.deepEqual(client.calls[1].input.config.projects, [...hostConfig.projects, { workspaceId: '42', stories: [], tasks: [] }])
    update(select(client.render(), 'targetWorkspaceId'), '')
    await submit(client.render())
    assert.deepEqual(client.calls[2].input.config.projects[0], config.projects[0])
  }
})

test('workspace save rejection keeps the draft and offers an explicit reload', async () => {
  const client = setup(({ operation }) => operation === 'get' ? ok() : reject('workspace-unavailable'))
  const tree = await client.load()
  update(select(tree, 'targetWorkspaceId'), firstWorkspace.id)
  await submit(client.render())
  const rejected = client.render()
  assert.match(htmlText(rejected), /Reload settings for the current workspace list/)
  assert(!htmlText(rejected).includes('sensitive-token-placeholder'))
  assert.equal(select(rejected, 'targetWorkspaceId').props.value, firstWorkspace.id)
  assert.equal(button(rejected, 'Save settings').props.disabled, false)
  await button(rejected, 'Reload settings and discard draft').props.onClick()
  assert.equal(select(client.render(), 'targetWorkspaceId').props.value, '')
  assert.deepEqual(client.calls.map(call => call.operation), ['get', 'save', 'get'])
})

test('credentials are write-only, mode-specific, and cleared after save or choosing Host refs', async () => {
  const client = setup(({ operation, input }) => operation === 'get' ? ok() : saved(input, {
    credentialSource: input.credentials?.mode === 'use-refs' ? 'refs' : 'visual',
  }))
  let tree = await client.load()
  assert.deepEqual(controls(tree, 'input').filter(node => node.props.type === 'password').map(node => node.props.value), [''])
  update(input(tree, 'token'), 'bearer-replacement')
  await submit(client.render())
  assert.deepEqual(client.calls[1].input.credentials, { mode: 'replace', token: 'bearer-replacement' })
  tree = client.render()
  assert.equal(input(tree, 'token').props.value, '')
  assert.match(htmlText(tree), /TAPD connection Saved credentials/)
  assert(!refsReset(visible(tree)))

  update(input(tree, 'token'), 'discard-on-mode-change')
  update(select(tree, 'auth'), 'basic')
  assert.equal(input(client.render(), 'token'), undefined)
  assert.match(htmlText(client.render()), /saved credentials or Host credential references for the selected method/)
  update(select(client.render(), 'auth'), 'bearer')
  assert.equal(input(client.render(), 'token').props.value, '')
  update(select(client.render(), 'auth'), 'basic')
  tree = client.render()
  for (const key of ['apiUser', 'apiKey']) {
    assert.equal(input(tree, key).props.type, 'password')
    assert.equal(input(tree, key).props.value, '')
  }
  update(input(tree, 'apiUser'), 'replacement account')
  submit(client.render())
  assert.match(htmlText(client.render()), /enter both the API account and key/)
  assert.equal(client.calls.length, 2)
  update(input(client.render(), 'apiKey'), 'replacement key')
  await submit(client.render())
  assert.deepEqual(client.calls[2].input.credentials, { mode: 'replace', apiUser: 'replacement account', apiKey: 'replacement key' })
  tree = client.render()
  assert.equal(input(tree, 'apiUser').props.value, '')
  assert.equal(input(tree, 'apiKey').props.value, '')

  update(input(tree, 'apiUser'), 'discard-on-refs')
  update(input(tree, 'apiKey'), 'discard-this-too')
  update(refsReset(tree), true)
  tree = client.render()
  for (const key of ['apiUser', 'apiKey']) {
    assert.equal(input(tree, key).props.value, '')
    assert.equal(input(tree, key).props.disabled, true)
  }
  update(select(tree, 'auth'), 'bearer')
  tree = client.render()
  assert.equal(refsReset(tree).props.checked, true)
  assert.equal(input(tree, 'token').props.disabled, true)
  await submit(tree)
  assert.deepEqual(client.calls[3].input.credentials, { mode: 'use-refs' })
  assert.equal(client.calls[3].input.config.auth, 'bearer')
  tree = client.render()
  assert.match(htmlText(tree), /TAPD connection Host credential references/)
  assert(!refsReset(tree))
  assert.equal(input(tree, 'token').props.value, '')
  assert.equal(input(tree, 'token').props.disabled, false)
})

test('updates an existing token independently while project lookup and an invalid settings draft are pending', async () => {
  let finishLookup
  let finishSave
  const client = setup(({ operation, input }) => {
    if (operation === 'get') return ok({ credentialSource: 'visual' })
    if (operation === 'discover-projects') return new Promise(resolve => { finishLookup = resolve })
    if (operation === 'save-credentials') return new Promise(resolve => { finishSave = resolve })
    assert.equal(operation, 'save')
    return saved(input)
  }, 'zh')
  let tree = await client.load()
  assert.equal(input(tree, 'token').props.value, '')
  assert.equal(button(tree, '保存凭据').props.disabled, true)
  update(input(tree, 'token'), 'new-pat')
  update(input(tree, 'intervalSeconds'), '29')
  const lookup = click(button(client.render(), '添加项目'))
  const rotation = click(button(client.render(), '保存凭据'))
  assert.deepEqual(client.calls[2], { operation: 'save-credentials', input: {
    expectedRevision: 3, auth: 'bearer', credentials: { mode: 'replace', token: 'new-pat' },
  } })
  assert.equal(button(client.render(), '正在保存凭据…').props.disabled, true)
  finishSave(ok({ revision: 4, source: 'visual', credentialSource: 'visual' }))
  await rotation
  finishLookup(discovered([{ id: '22', name: 'Stale project list' }], { currentNick: 'Tavlo' }))
  await lookup
  tree = client.render()
  assert.equal(input(tree, 'token').props.value, '')
  assert.equal(input(tree, 'intervalSeconds').props.value, '29')
  assert.deepEqual(projectIds(tree), [exactId, ''])
  assert.match(htmlText(step(tree, 'connection')), /凭据已保存，其他设置未更改/)
  assert.doesNotMatch(htmlText(tree), /Stale project list|new-pat|正在加载 TAPD 项目/)
  update(input(tree, 'intervalSeconds'), '30')
  update(input(projectRows(client.render())[1], 'workspaceId'), '33')
  await submit(client.render())
  assert.equal(client.calls[3].input.expectedRevision, 4)
  assert.equal(Object.hasOwn(client.calls[3].input, 'credentials'), false)
})

test('conflict never auto-retries a write and requires an explicit reload before using the new revision', async () => {
  let readCount = 0
  let saveCount = 0
  const client = setup(({ operation, input }) => {
    if (operation === 'get') return ++readCount === 1 ? ok() : ok({ revision: 9, config: { ...config, owner: 'Latest' } })
    return ++saveCount === 1 ? reject('revision-conflict') : saved(input)
  })
  let tree = await client.load()
  update(input(tree, 'owner'), 'Stale draft')
  update(input(tree, 'token'), 'stale replacement')
  await submit(client.render())
  tree = client.render()
  assert.match(htmlText(tree), /These settings were changed elsewhere/)
  assert(!htmlText(tree).includes('sensitive-token-placeholder'))
  assert.equal(button(tree, 'Save settings').props.disabled, true)
  submit(tree)
  assert.equal(client.calls.length, 2)
  await button(tree, 'Reload settings and discard draft').props.onClick()
  tree = client.render()
  assert.equal(input(tree, 'owner').props.value, 'Latest')
  assert.equal(input(tree, 'token').props.value, '')
  assert.equal(button(tree, 'Save settings').props.disabled, false)
  await submit(tree)
  assert.equal(client.calls[3].input.expectedRevision, 9)
  assert.equal(Object.hasOwn(client.calls[3].input, 'credentials'), false)
})

test('validates local ranges, exact IDs, valid status keys, required scopes, and the project cap', async () => {
  let reads = 0
  const client = setup(({ operation, input }) => {
    if (operation === 'get') return ok()
    if (operation === 'discover-statuses') return ++reads === 1
      ? statuses([['显示名称', 'Invalid key']])
      : statuses([['open', 'Open'], ['planning', 'Planning']], [['progressing', 'In progress']])
    assert.equal(operation, 'save')
    return saved(input)
  })
  let tree = await client.load()
  update(input(tree, 'intervalSeconds'), '29')
  submit(client.render())
  assert.match(htmlText(client.render()), /polling limits/)
  update(input(client.render(), 'intervalSeconds'), '30')
  update(input(client.render(), 'maxNewPerScope'), '1001')
  submit(client.render())
  assert.match(htmlText(client.render()), /polling limits/)
  update(input(client.render(), 'maxNewPerScope'), '1000')
  update(input(client.render(), 'workspaceId'), ` ${exactId}`)
  submit(client.render())
  assert.match(htmlText(client.render()), /project IDs/)
  update(input(client.render(), 'workspaceId'), exactId)
  const row = () => projectRows(client.render())[0]
  await click(button(row(), 'Load status options'))
  assert.match(htmlText(row()), /Could not read TAPD statuses/)
  assert.equal(statusToggle(row(), 'Invalid key'), undefined)
  assert.match(htmlText(row()), /Story statuses: 2.*Task statuses: 1/)
  await click(button(row(), 'Reload statuses'))
  for (const label of ['Open', 'Planning', 'In progress']) update(statusToggle(row(), label), false)
  assert.match(htmlText(row()), /No statuses selected/)
  submit(client.render())
  assert.match(htmlText(client.render()), /at least one project with a story or task status key/)
  update(statusToggle(row(), 'Open'), true)
  const idFields = tree => controls(tree, 'input').filter(node => node.props.id?.endsWith('-workspaceId'))
  button(client.render(), 'Add manually').props.onClick()
  update(idFields(client.render())[1], exactId)
  submit(client.render())
  assert.match(htmlText(client.render()), /can only appear once/)
  assert.deepEqual(client.calls.map(call => call.operation), ['get', 'discover-statuses', 'discover-statuses'])
  update(idFields(client.render())[1], exactId.slice(1))
  await submit(client.render())
  assert.deepEqual(client.calls[3].input.config.projects, [
    { workspaceId: exactId, stories: ['open'], tasks: [] }, { workspaceId: exactId.slice(1), stories: [], tasks: [] },
  ])
  for (let i = 2; i < 20; i++) button(client.render(), 'Add manually').props.onClick()
  tree = client.render()
  assert.equal(idFields(tree).length, 20)
  assert.equal(button(tree, 'Add manually').props.disabled, true)
  controls(tree, 'button').find(node => node.props['aria-label'] === 'Remove project 2').props.onClick()
  assert.equal(idFields(client.render()).length, 19)
  assert.equal(button(client.render(), 'Add manually').props.disabled, false)
})

test('known Host errors use localized messages and transport ambiguity can only be resolved by reload', async () => {
  const errors = ['settings-unavailable', 'invalid-config', 'duplicate-project', 'missing-scopes', 'invalid-credentials', 'other']
  let saveTry = 0
  let readTry = 0
  const client = setup(({ operation }) => {
    if (operation === 'get') return ++readTry === 1 ? reject('settings-unavailable') : ok()
    if (saveTry >= errors.length) throw Error('sensitive-token-placeholder')
    return reject(errors[saveTry++])
  })
  let tree = await client.load()
  assert.match(htmlText(tree), /settings are unavailable on this Host/)
  await button(tree, 'Retry loading').props.onClick()
  for (const message of [/unavailable on this Host/, /polling limits/, /appear once/, /status key to enable sync/, /replacement credentials are invalid/, /Could not save TAPD settings/]) {
    await submit(client.render())
    tree = client.render()
    const alert = controls(tree, 'p').find(node => node.props.role === 'alert')
    assert.match(htmlText(alert), message)
    assert(!htmlText(tree).includes('sensitive-token-placeholder'))
  }
  await submit(client.render())
  tree = client.render()
  assert.match(htmlText(tree), /Could not confirm the save/)
  assert(!htmlText(tree).includes('sensitive-token-placeholder'))
  assert.equal(button(tree, 'Save settings').props.disabled, true)
  assert(button(tree, 'Reload settings and discard draft'))
})

test('in-flight saves are not duplicated and late replies do not write state after unmount', async () => {
  let finish
  const client = setup(({ operation }) => operation === 'get' ? ok() : new Promise(resolve => { finish = resolve }))
  const tree = await client.load()
  const pending = submit(tree)
  submit(tree)
  assert.equal(client.calls.length, 2)
  assert.equal(button(client.render(), 'Saving…').props.disabled, true)
  client.unmount()
  finish(ok())
  await pending
  assert.equal(client.staleWrites(), 0)
})

test('Bearer Add project looks up with a draft token and opens one searchable chooser for unused projects', async () => {
  let finish
  const credentials = { mode: 'replace', token: 'auto-preview-only' }
  const client = setup(({ operation, input }) => {
    if (operation === 'get') return ok({ config: { ...config, seedWorkspaceId: seedId } })
    if (operation === 'discover-projects') return new Promise(resolve => { finish = resolve })
    if (operation === 'discover-statuses') return statuses()
    assert.equal(operation, 'save')
    return saved(input, { credentialSource: 'visual' })
  })
  let tree = await client.load()
  update(input(tree, 'owner'), '  ')
  update(input(tree, 'token'), credentials.token)
  const request = click(button(visible(client.render()), 'Add project'))
  assert.deepEqual(client.calls[1], { operation: 'discover-projects', input: { auth: 'bearer', auto: true, credentials } })
  assert.deepEqual(projectIds(client.render()), [exactId, ''])
  assert.equal(input(projectRows(visible(client.render()))[1], 'workspaceId').props.disabled, undefined)
  assert.match(htmlText(step(client.render(), 'projects')), /enter a project ID without waiting/)
  assert.equal(button(client.render(), 'Add project').props.disabled, true)
  finish(discovered([
    { id: exactId, name: 'Existing project' }, { id: '22', name: 'Checkout' }, { id: '33', name: 'Support' },
  ], { currentNick: 'Current TAPD user' }))
  await request
  tree = client.render()
  assert.equal(input(tree, 'owner').props.value, 'Current TAPD user')
  assert.equal(input(tree, 'discoveryLink').props.value, seedLink)
  assert.deepEqual(projectIds(tree), [exactId, ''])

  await click(button(tree, 'Add project'))
  assert.deepEqual(projectIds(client.render()), [exactId, ''])
  const row = i => projectRows(client.render())[i]
  const picker = chooser(visible(row(1)))
  assert.equal(picker.props.type, 'text')
  assert.equal(picker.props['aria-expanded'], false)
  assert.equal(picker.props['aria-autocomplete'], 'list')
  assert.equal(controls(visible(row(1)), 'input').length, 1)
  picker.props.onFocus()
  assert.equal(chooser(row(1)).props['aria-expanded'], true)
  assert.equal(withRole(visible(row(1)), 'listbox')[0].props.id, picker.props['aria-controls'])
  assert.equal(projectOption(row(1), exactId).props['aria-disabled'], true)
  assert.equal(projectOption(row(1), exactId).props.onClick, undefined)
  assert.equal(chooser(row(0)).props['aria-expanded'], false)
  click(projectOption(row(1), '22'))
  await setImmediate()
  assert.equal(chooser(row(1)).props.value, 'Checkout')
  assert.equal(chooser(row(1)).props['aria-expanded'], false)
  await click(button(client.render(), 'Add project'))
  assert.deepEqual(projectIds(client.render()), [exactId, '22', ''])
  update(chooser(row(2)), '33')
  assert.deepEqual(projectOptions(row(2)).map(htmlText), ['Support (33)'])
  press(chooser(row(2)), 'ArrowDown')
  assert.equal(chooser(row(2)).props['aria-activedescendant'], projectOption(row(2), '33').props.id)
  press(chooser(row(2)), 'Enter')
  await setImmediate()
  await click(button(client.render(), 'Add project'))
  tree = client.render()
  assert.deepEqual(projectIds(tree), [exactId, '22', '33'])
  assert.match(htmlText(step(tree, 'projects')), /All projects returned by TAPD are already selected/)
  assert.deepEqual(client.calls.slice(2), ['22', '33'].map(workspaceId => ({
    operation: 'discover-statuses', input: { auth: 'bearer', workspaceId, credentials },
  })))

  await submit(tree)
  assert.deepEqual(client.calls[4], { operation: 'save', input: { expectedRevision: 3, config: {
    ...config, owner: 'Current TAPD user', seedWorkspaceId: seedId, projects: [...config.projects,
      { workspaceId: '22', stories: [], tasks: [] }, { workspaceId: '33', stories: [], tasks: [] }],
  }, credentials } })
})

test('late project suggestions neither replace focused manual entry nor resurrect a removed row', async () => {
  let finishLookup
  const client = setup(({ operation }) => {
    if (operation === 'get') return ok()
    assert.equal(operation, 'discover-projects')
    return new Promise(resolve => { finishLookup = resolve })
  })
  const start = () => click(button(client.render(), 'Add project'))
  let tree = await client.load()
  const first = start()
  const firstRow = () => projectRows(client.render())[1]
  input(firstRow(), 'workspaceId').props.onFocus()
  update(input(firstRow(), 'workspaceId'), '42')
  finishLookup(discovered([], { currentNick: 'Tavlo' }))
  await first
  const second = start()
  const row = () => projectRows(client.render())[2]
  click(button(row(), 'Remove'))
  finishLookup(discovered([{ id: '42', name: 'Matched by lookup' }, { id: '51', name: 'Another project' }], { currentNick: 'Tavlo' }))
  await second
  tree = client.render()
  assert.deepEqual(projectIds(tree), [exactId, '42'])
  assert.equal(chooser(firstRow()), undefined)
  assert.equal(input(firstRow(), 'workspaceId').props.value, '42')
})

test('automatic failures and empty lists keep the editable blank row; Add retries without duplicating it', async () => {
  const failures = [
    [reject('discovery-forbidden'), /can’t list TAPD projects/],
    [reject('current-user-unavailable'), /TAPD did not identify the current user/],
    [reject('project-context-required'), /Try a project link to identify the company/],
    [discovered([], { currentNick: 'Different TAPD user' }), /TAPD returned no projects/],
  ]
  let attempts = 0
  const client = setup(({ operation }) => {
    if (operation === 'get') return ok({ config: { ...config, companyId: '007' } })
    assert.equal(operation, 'discover-projects')
    return failures[attempts++]?.[0] ?? discovered([{ id: seedId, name: 'Retried project' }], { currentNick: 'Different TAPD user' })
  })
  let tree = await client.load()
  for (const [, hint] of failures) {
    await click(button(visible(tree), 'Add project'))
    tree = client.render()
    assert.match(htmlText(step(tree, 'projects')), hint)
    assert.doesNotMatch(htmlText(tree), /sensitive-token-placeholder/)
    assert.deepEqual(projectIds(tree), [exactId, ''])
    assert.equal(chooser(tree), undefined)
    assert.equal(input(tree, 'owner').props.value, 'Tavlo')
  }

  assert.equal(client.calls.length, failures.length + 1)
  await click(button(visible(tree), 'Add project'))
  tree = client.render()
  assert.deepEqual(projectIds(tree), [exactId, ''])
  chooser(projectRows(tree)[1]).props.onFocus()
  assert.equal(htmlText(projectOption(projectRows(client.render())[1], seedId)), `Retried project (${seedId})`)
  assert.equal(input(tree, 'owner').props.value, 'Tavlo')
  assert.deepEqual(client.calls.slice(1), Array(failures.length + 1).fill({
    operation: 'discover-projects', input: { auth: 'bearer', auto: true },
  }))
})

test('shows the exhausted choices hint on the first successful lookup if every result is already selected', async () => {
  const client = setup(({ operation }) => {
    if (operation === 'get') return ok()
    assert.equal(operation, 'discover-projects')
    return discovered([{ id: exactId, name: 'Existing project' }], { currentNick: 'Tavlo' })
  })
  let tree = await client.load()
  await button(tree, 'Add project').props.onClick()
  tree = client.render()
  assert.deepEqual(projectIds(tree), [exactId, ''])
  assert(input(projectRows(visible(tree))[1], 'workspaceId'))
  assert.match(htmlText(step(tree, 'projects')), /All projects returned by TAPD are already selected/)
  assert.equal(client.calls.length, 2)
})

test('puts the optional TAPD link under project lookup alternatives and saves only its exact project ID', async () => {
  const client = setup(({ operation, input }) => operation === 'get' ? ok() : saved(input))
  let tree = await client.load()
  const connection = step(tree, 'connection')
  const projects = step(tree, 'projects')
  const link = input(projects, 'discoveryLink')
  const alternatives = controls(projects, 'details').find(node => htmlText(node.children[0]) === 'Project lookup alternatives')
  assert.equal(input(alternatives, 'discoveryLink'), link)
  assert.equal(input(visible(projects), 'discoveryLink'), undefined)
  for (const label of ['Add manually', 'Add from a link']) {
    assert(button(alternatives, label))
    assert.equal(button(visible(projects), label), undefined)
  }
  assert.equal(button(alternatives, 'Add from a link').props.disabled, true)
  assert.equal(link.props.value, '')
  assert.equal(input(connection, 'discoveryLink'), undefined)
  assert.equal(controls(tree, 'input').filter(node => node.props.id?.endsWith('-discoveryLink')).length, 1)
  assert.equal(input(tree, 'companyId'), undefined)
  assert.equal(input(tree, 'discoveryNick'), undefined)
  assert.equal(button(tree, 'Discover projects'), undefined)
  assert.equal(button(tree, 'Refresh projects'), undefined)
  assert(controls(tree, 'style').some(node => Object.hasOwn(node.props, 'data-tavlo-tapd-arc-styles')))

  update(link, `${seedLink}prong/tasks/view/123?session=discard-me#discard-too`)
  assert.equal(client.calls.length, 1)
  await submit(client.render())
  assert.deepEqual(client.calls[1], { operation: 'save', input: { expectedRevision: 3, config: { ...config, seedWorkspaceId: seedId } } })
  tree = client.render()
  assert.equal(input(tree, 'discoveryLink').props.value, seedLink)
  assert.deepEqual(projectIds(tree), [exactId])
})

test('loads a saved link and preserves the hidden legacy company ID without using it for Bearer discovery', async () => {
  const hostConfig = { ...config, seedWorkspaceId: seedId, companyId: '007' }
  const client = setup(({ operation, input }) => {
    if (operation === 'get') return ok({ config: hostConfig })
    if (operation === 'discover-projects') return discovered([{ id: seedId, name: 'Linked project' }], { companyId: '085', scope: 'company' })
    assert.equal(operation, 'save')
    return saved(input)
  })
  let tree = await client.load()
  assert.equal(input(tree, 'discoveryLink').props.value, seedLink)
  assert.equal(input(tree, 'companyId'), undefined)
  await click(button(tree, 'Add from a link'))
  assert.deepEqual(client.calls[1], { operation: 'discover-projects', input: { auth: 'bearer', seedWorkspaceId: seedId, nick: 'Tavlo' } })
  tree = client.render()
  assert.deepEqual(projectIds(tree), [exactId, seedId])
  assert.equal(chooser(projectRows(tree)[1]).props.value, 'Linked project')
  assert.match(htmlText(step(tree, 'projects')), /This is the TAPD company’s project list/)
  update(input(tree, 'discoveryLink'), '')
  click(button(client.render(), 'Add manually'))
  tree = client.render()
  assert.deepEqual(projectIds(tree), [exactId, seedId, ''])
  assert.equal(chooser(tree), undefined)
  assert.deepEqual(client.calls.map(call => call.operation), ['get', 'discover-projects'])
  update(input(projectRows(tree)[2], 'workspaceId'), '42')
  await submit(client.render())
  assert.deepEqual(client.calls[2], { operation: 'save', input: { expectedRevision: 3, config: {
    ...config, companyId: '007', projects: [...config.projects, { workspaceId: seedId, stories: [], tasks: [] }, { workspaceId: '42', stories: [], tasks: [] }],
  } } })
  assert.equal(input(client.render(), 'discoveryLink').props.value, '')
})

test('explicit Add from a link preselects once; a searched choice loads status names and saves its exact key', async () => {
  let completeStatuses
  const credentials = { mode: 'replace', token: 'preview-only-secret' }
  const client = setup(({ operation, input }) => {
    if (operation === 'get') return ok()
    if (operation === 'discover-projects') return discovered([
      { id: exactId, name: '平台研发' }, { id: seedId, name: 'Linked project' }, { id: '22', name: 'Mobile Checkout' },
    ], { scope: 'company', companyId: '608', token: 'ignored-response-extra' })
    if (operation === 'discover-statuses') return new Promise(resolve => { completeStatuses = resolve })
    assert.equal(operation, 'save')
    return saved(input, { credentialSource: 'visual' })
  })
  let tree = await client.load()
  update(input(tree, 'token'), credentials.token)
  update(input(client.render(), 'discoveryLink'), `${seedLink}prong/tasks/view/123?session=discard-me#discard-too`)
  assert.equal(client.calls.length, 1)
  await click(button(client.render(), 'Add from a link'))
  assert.deepEqual(client.calls[1], { operation: 'discover-projects', input: {
    auth: 'bearer', nick: 'Tavlo', seedWorkspaceId: seedId, credentials,
  } })
  tree = client.render()
  assert.deepEqual(projectIds(tree), [exactId, seedId])
  assert.equal(chooser(projectRows(tree)[1]).props.value, 'Linked project')
  assert.doesNotMatch(htmlText(tree), /preview-only-secret|ignored-response-extra|discard-me/)
  assert.equal(input(tree, 'token').props.type, 'password')
  assert.match(htmlText(projectRows(tree)[0]), /Story statuses: 2.*Task statuses: 1/)
  await click(button(tree, 'Add from a link'))
  assert.deepEqual(projectIds(client.render()), [exactId, seedId])
  assert.equal(client.calls.length, 2)

  await click(button(visible(client.render()), 'Add project'))
  assert.deepEqual(projectIds(client.render()), [exactId, seedId, ''])
  assert.equal(client.calls.length, 2)
  const row = () => projectRows(client.render())[2]
  chooser(row()).props.onFocus()
  for (const id of [seedId, exactId]) assert.equal(projectOption(row(), id).props['aria-disabled'], true)
  update(chooser(row()), 'missing search')
  assert.match(htmlText(visible(row())), /No projects match/)
  update(chooser(row()), '  cHeCkOuT  ')
  assert.deepEqual(projectOptions(row()).map(htmlText), ['Mobile Checkout (22)'])
  assert.deepEqual(projectIds(client.render()), [exactId, seedId, ''])
  assert.equal(client.calls.length, 2)
  click(projectOption(row(), '22'))
  assert.equal(chooser(row()).props.value, 'Mobile Checkout')
  assert.equal(button(row(), 'Loading TAPD statuses…').props.disabled, true)
  assert.deepEqual(client.calls[2], { operation: 'discover-statuses', input: { auth: 'bearer', workspaceId: '22', credentials } })
  chooser(row()).props.onFocus()
  click(projectOption(row(), '22'))
  assert.equal(client.calls.length, 3)
  completeStatuses(statuses([['api_review_pending', 'Ready for review'], ['open', 'Open']], [['api_task_done', 'Done']]))
  await setImmediate()
  assert(button(row(), 'Reload statuses'))
  assert.equal(statusToggle(row(), 'Ready for review').props.checked, false)
  assert.equal(statusToggle(row(), 'Done').props.checked, false)
  assert.doesNotMatch(htmlText(row()), /api_review_pending|api_task_done/)
  update(statusToggle(row(), 'Ready for review'), true)
  assert.match(htmlText(row()), /Story statuses: 1/)
  assert.doesNotMatch(htmlText(row()), /Task statuses: \d/)
  await submit(client.render())
  assert.deepEqual(client.calls[3], { operation: 'save', input: { expectedRevision: 3, config: {
    ...config, seedWorkspaceId: seedId, projects: [...config.projects,
      { workspaceId: seedId, stories: [], tasks: [] }, { workspaceId: '22', stories: ['api_review_pending'], tasks: [] }],
  }, credentials } })
  tree = client.render()
  assert.equal(input(tree, 'token').props.value, '')
  assert.equal(input(tree, 'discoveryLink').props.value, seedLink)
  assert.equal(chooser(tree), undefined)
  assert.doesNotMatch(htmlText(tree), /Ready for review|Mobile Checkout/)
})

test('invalid nonempty links block explicit link lookup and save, but not regular Bearer Add', async () => {
  const client = setup(({ operation }) => {
    if (operation === 'get') return ok()
    assert.equal(operation, 'discover-projects')
    return discovered([{ id: '42', name: 'Automatic choice' }], { currentNick: 'Tavlo' })
  })
  let tree = await client.load()
  const hint = /Use a TAPD HTTPS link/
  for (const invalid of ['http://www.tapd.cn/42/', 'https://www.tapd.cn.example/42', 'https://person@www.tapd.cn/42', 'https://www.tapd.cn/abc']) {
    update(input(tree, 'discoveryLink'), invalid)
    await click(button(client.render(), 'Add from a link'))
    tree = client.render()
    assert.match(htmlText(step(tree, 'projects')), hint)
    assert.deepEqual(projectIds(tree), [exactId])
    submit(tree)
    tree = client.render()
    assert.match(htmlText(withRole(tree, 'alert')), hint)
    assert.equal(input(tree, 'discoveryLink').props.value, invalid)
    assert.deepEqual(client.calls, [{ operation: 'get', input: {} }])
  }
  await click(button(visible(tree), 'Add project'))
  assert.deepEqual(client.calls[1], { operation: 'discover-projects', input: { auth: 'bearer', auto: true } })
  assert.deepEqual(projectIds(client.render()), [exactId, ''])
})

test('a failed explicit link lookup leaves the linked row editable and retries without duplicating it', async () => {
  let listAttempts = 0
  const client = setup(({ operation, input }) => {
    if (operation === 'get') return ok()
    if (operation === 'discover-projects') return ++listAttempts === 1 ? reject('discovery-forbidden') : discovered([
      { id: seedId, name: 'Retried link' }, { id: '22', name: 'Retried choice' },
    ], { scope: 'company' })
    if (operation === 'discover-statuses') return reject('discovery-forbidden')
    assert.equal(operation, 'save')
    return saved(input)
  })
  const row = () => projectRows(client.render())[1]
  let tree = await client.load()
  update(input(tree, 'discoveryLink'), seedLink)
  await click(button(client.render(), 'Add from a link'))
  tree = client.render()
  assert.match(htmlText(tree), /can’t list TAPD projects/)
  assert.doesNotMatch(htmlText(tree), /sensitive-token-placeholder/)
  assert.deepEqual(projectIds(tree), [exactId, seedId])
  assert.equal(chooser(tree), undefined)
  const manualId = input(visible(row()), 'workspaceId')
  assert(!manualId.props.disabled && !manualId.props.readOnly)
  assert.match(htmlText(row()), /TAPD project ID.*No statuses selected/)
  await click(button(row(), 'Load status options'))
  assert.match(htmlText(row()), /can’t read statuses for this project/)
  assert(button(row(), 'Reload statuses'))
  assert(!input(row(), 'stories'))
  assert(!input(row(), 'tasks'))

  await click(button(client.render(), 'Add from a link'))
  assert.deepEqual(client.calls.slice(1), [
    { operation: 'discover-projects', input: { auth: 'bearer', seedWorkspaceId: seedId, nick: 'Tavlo' } },
    { operation: 'discover-statuses', input: { auth: 'bearer', workspaceId: seedId } },
    { operation: 'discover-projects', input: { auth: 'bearer', seedWorkspaceId: seedId, nick: 'Tavlo' } },
  ])
  assert.deepEqual(projectIds(client.render()), [exactId, seedId])
  assert.equal(chooser(row()).props.value, 'Retried link')
  assert.match(htmlText(row()), /No statuses selected.*can’t read statuses/)
  await submit(client.render())
  assert.deepEqual(client.calls[4].input.config.projects, [...config.projects, { workspaceId: seedId, stories: [], tasks: [] }])
})

test('status errors retain saved keys; a successful work item type remains editable when the other fails', async () => {
  const existing = { workspaceId: exactId, stories: ['story_active', 'story_legacy'], tasks: ['task_retired'] }
  const hostConfig = { ...config, projects: [existing] }
  let reads = 0
  const client = setup(({ operation, input }) => {
    if (operation === 'get') return ok({ config: hostConfig })
    if (operation === 'discover-statuses') return ++reads === 1 ? reject('auth') : statuses([
      ['story_active', 'Active'], ['story_review', 'In review'],
    ], [], { partial: true, errors: { tasks: 'tapd/discovery-forbidden' } })
    assert.equal(operation, 'save')
    return saved(input)
  })
  const row = () => projectRows(client.render())[0]
  const stories = () => statusGroup(row(), 'Story statuses')
  const tasks = () => statusGroup(row(), 'Task statuses')
  await client.load()
  await click(button(row(), 'Load status options'))
  assert.match(htmlText(row()), /TAPD rejected these credentials/)
  assert.doesNotMatch(htmlText(row()), /sensitive-token-placeholder|story_active|story_legacy|task_retired/)
  assert.match(htmlText(row()), /Story statuses: 2.*Task statuses: 1/)
  assert(!button(row(), 'Deselect unlisted statuses'))
  await submit(client.render())
  assert.deepEqual(client.calls[2], { operation: 'save', input: { expectedRevision: 3, config: hostConfig } })

  await click(button(row(), 'Reload statuses'))
  assert.deepEqual(client.calls[3], client.calls[1])
  assert.match(htmlText(row()), /TAPD returned only some of the statuses/)
  assert.doesNotMatch(htmlText(row()), /story_active|story_legacy|story_review|task_retired|tapd\/discovery-forbidden/)
  assert.equal(statusToggle(stories(), 'Active').props.checked, true)
  assert.equal(statusToggle(stories(), 'In review').props.checked, false)
  assert.match(htmlText(stories()), /1 other selected statuses are not listed and will be kept/)
  assert.match(htmlText(tasks()), /can’t read statuses for this project.*1 other selected statuses are not listed and will be kept/)
  assert.equal(controls(tasks(), 'input').length, 0)
  assert(!button(tasks(), 'Deselect unlisted statuses'))
  assert(!input(row(), 'stories'))
  assert(!input(row(), 'tasks'))
  update(statusToggle(stories(), 'In review'), true)
  assert.match(htmlText(row()), /Story statuses: 3.*Task statuses: 1/)
  await submit(client.render())
  assert.deepEqual(client.calls[4], { operation: 'save', input: { expectedRevision: 4, config: {
    ...hostConfig, projects: [{ ...existing, stories: ['story_active', 'story_legacy', 'story_review'] }],
  } } })

  click(button(stories(), 'Deselect unlisted statuses'))
  assert.match(htmlText(row()), /Story statuses: 2.*Task statuses: 1/)
  assert.equal(statusToggle(stories(), 'Active').props.checked, true)
  assert.equal(statusToggle(stories(), 'In review').props.checked, true)
  assert(!button(stories(), 'Deselect unlisted statuses'))
  assert(!button(tasks(), 'Deselect unlisted statuses'))
  await submit(client.render())
  assert.deepEqual(client.calls[5].input.config.projects, [{ ...existing, stories: ['story_active', 'story_review'] }])
})

test('labeled standard task choices are opt-in and preserve legacy states without an unverified cleanup action', async () => {
  const existing = { ...config.projects[0], tasks: ['legacy_task_state'] }
  const hostConfig = { ...config, projects: [existing] }
  const client = setup(({ operation, input }) => {
    if (operation === 'get') return ok({ config: hostConfig })
    if (operation === 'discover-statuses') return statuses([['planning', 'Planning']], [], {
      errors: { tasks: 'tapd/api' }, standardTaskOptions: true,
    })
    assert.equal(operation, 'save')
    return saved(input)
  })
  const row = () => projectRows(client.render())[0]
  await client.load()
  await click(button(row(), 'Load status options'))
  const tasks = () => statusGroup(row(), 'Task statuses')
  assert.match(htmlText(tasks()), /TAPD’s standard options; selecting them does not confirm task access/)
  assert.match(htmlText(tasks()), /1 other selected statuses are not listed and will be kept/)
  for (const name of ['Not started', 'In progress', 'Completed']) assert.equal(statusToggle(tasks(), name).props.checked, false)
  assert(!button(tasks(), 'Deselect unlisted statuses'))
  await submit(client.render())
  assert.deepEqual(client.calls[2].input.config, hostConfig)
  update(statusToggle(tasks(), 'In progress'), true)
  await submit(client.render())
  assert.deepEqual(client.calls[3].input.config.projects[0].tasks, ['legacy_task_state', 'progressing'])
})

test('explicit Bearer link lookup preselects the ID but requires the token owner’s nickname for listing', async () => {
  const client = setup(({ operation }) => {
    if (operation === 'get') return ok()
    assert.equal(operation, 'discover-projects')
    return discovered([{ id: seedId, name: 'Linked project' }, { id: '22', name: 'Another project' }], { scope: 'company' })
  })
  let tree = await client.load()
  update(input(tree, 'owner'), '  ')
  update(input(client.render(), 'discoveryLink'), seedLink)
  await click(button(client.render(), 'Add from a link'))
  tree = client.render()
  assert.deepEqual(projectIds(tree), [exactId, seedId])
  assert.equal(chooser(tree), undefined)
  assert.match(htmlText(step(tree, 'projects')), /enter the token owner’s TAPD nickname/)
  assert.deepEqual(client.calls.map(call => call.operation), ['get'])

  update(input(tree, 'owner'), '  List owner  ')
  await click(button(client.render(), 'Add from a link'))
  assert.deepEqual(client.calls[1], { operation: 'discover-projects', input: { auth: 'bearer', seedWorkspaceId: seedId, nick: 'List owner' } })
  assert.deepEqual(projectIds(client.render()), [exactId, seedId])
  assert(chooser(client.render()))
})

test('Basic Add validates credential pairs and previews Host refs using link context without preselecting it', async () => {
  const codes = ['invalid-credentials', 'auth', 'rate-limit']
  const client = setup(({ operation }) => {
    if (operation === 'get') return ok({ credentialSource: 'visual' })
    assert.equal(operation, 'discover-projects')
    return codes.length ? reject(codes.shift()) : discovered([{ id: seedId, name: 'Basic choice' }], { scope: 'company' })
  })
  let tree = await client.load()
  update(select(tree, 'auth'), 'basic')
  await click(button(visible(client.render()), 'Add project'))
  tree = client.render()
  assert.match(htmlText(tree), /add a project link under Project lookup alternatives/)
  assert.equal(client.calls.length, 1)
  update(input(tree, 'owner'), '')
  update(input(tree, 'discoveryLink'), seedLink)
  update(input(tree, 'apiUser'), 'partial-account')
  await click(button(visible(client.render()), 'Add project'))
  tree = client.render()
  assert.match(htmlText(tree), /enter both the API account and key/)
  assert.equal(client.calls.length, 1)
  update(refsReset(tree), true)
  for (const text of [/Set up TAPD credentials or Host references/, /TAPD rejected these credentials/, /TAPD is limiting requests/]) {
    await click(button(visible(client.render()), 'Add project'))
    assert.match(htmlText(client.render()), text)
    assert.deepEqual(projectIds(client.render()), [exactId, ''])
  }
  await click(button(visible(client.render()), 'Add project'))
  tree = client.render()
  assert.deepEqual(projectIds(tree), [exactId, ''])
  chooser(projectRows(tree)[1]).props.onFocus()
  assert.equal(htmlText(projectOption(projectRows(client.render())[1], seedId)), `Basic choice (${seedId})`)
  assert.deepEqual(client.calls.slice(1), Array(4).fill({ operation: 'discover-projects', input: {
    auth: 'basic', seedWorkspaceId: seedId, credentials: { mode: 'use-refs' },
  } }))
  assert.doesNotMatch(htmlText(client.render()), /sensitive-token-placeholder|partial-account/)
})

test('changing the TAPD link invalidates cached and in-flight choices, and late replies after unmount are ignored', async () => {
  const resolutions = []
  const client = setup(({ operation }) => {
    if (operation === 'get') return ok()
    assert.equal(operation, 'discover-projects')
    return new Promise(resolve => resolutions.push(resolve))
  })
  const setLink = id => update(input(client.render(), 'discoveryLink'), `https://www.tapd.cn/${id}/`)
  const add = () => click(button(client.render(), 'Add from a link'))
  await client.load()
  setLink(seedId)
  const first = add()
  assert.deepEqual(projectIds(client.render()), [exactId, seedId])
  resolutions[0](discovered([{ id: seedId, name: 'First linked project' }]))
  await first
  await setImmediate()
  assert.match(htmlText(client.render()), /First linked project/)

  setLink('00456')
  assert.equal(chooser(client.render()), undefined)
  const superseded = add()
  setLink('00789')
  const current = add()
  assert.deepEqual(client.calls.slice(1).map(call => call.input.seedWorkspaceId), [seedId, '00456', '00789'])
  assert.deepEqual(projectIds(client.render()), [exactId, seedId, '00456', '00789'])
  resolutions[2](discovered([{ id: '00789', name: 'Current linked project' }]))
  await current
  resolutions[1](discovered([{ id: '00456', name: 'Superseded linked project' }]))
  await superseded
  await setImmediate()
  assert.match(htmlText(client.render()), /Current linked project/)
  assert.doesNotMatch(htmlText(client.render()), /First linked project|Superseded linked project/)

  setLink('00321')
  const late = add()
  client.unmount()
  resolutions[3](discovered([]))
  await late
  await setImmediate()
  assert.equal(client.staleWrites(), 0)
})

test('uses optional last-updated windows and preserves preset and custom values across saves', async () => {
  const client = setup(({ operation, input }) => operation === 'get' ? ok({ config: { ...config, lookbackDays: 90 } }) : saved(input))
  let tree = await client.load()
  assert.equal(select(tree, 'lookback').props.value, '90')
  assert.equal(select(visible(tree), 'lookback'), undefined)
  assert.match(htmlText(tree), /last-updated time in China time \(UTC\+8\), not the creation date/)
  assert.deepEqual(controls(select(tree, 'lookback'), 'option').map(option => option.props.value), ['', '7', '30', '90', 'custom'])
  update(select(tree, 'lookback'), 'custom')
  for (const invalid of ['0', '366', 'NaN', '12.5']) {
    update(input(client.render(), 'lookbackDays'), invalid)
    submit(client.render())
    assert.match(htmlText(client.render()), /whole number from 1 to 365/)
  }
  assert.equal(client.calls.length, 1)
  update(input(client.render(), 'lookbackDays'), '365')
  await submit(client.render())
  assert.equal(client.calls[1].input.config.lookbackDays, 365)
  tree = client.render()
  assert.equal(input(tree, 'lookbackDays').props.value, '365')
  update(select(tree, 'lookback'), '')
  await submit(client.render())
  assert.equal(Object.hasOwn(client.calls[2].input.config, 'lookbackDays'), false)
})

test('links directly to verified official guidance for both authentication modes without exposing saved values', async () => {
  const client = setup(() => ok({ configured: false, credentialSource: 'none' }))
  let tree = await client.load()
  assert.match(htmlText(tree), /我的 → 个人访问令牌.*not into a chat/)
  assert(controls(tree, 'a').some(link => link.props.href === 'https://www.tapd.cn/personal_settings/index?tab=personal_token'))
  update(select(tree, 'auth'), 'basic')
  tree = client.render()
  assert.match(htmlText(tree), /公司管理 → 开放集成 → API账号管理.*not your TAPD login or password/)
  assert(controls(tree, 'a').some(link => link.props.href === 'https://open.tapd.cn/document/api-doc/API文档/API配置指引.html'))
  assert(controls(tree, 'a').every(link => link.props.rel === 'noopener noreferrer'))
})
