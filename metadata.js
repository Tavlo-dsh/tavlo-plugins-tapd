import { z } from 'zod'
import { requestTapdData, TapdError } from './tapd.js'

// The official workspace catalog endpoints explicitly return all matches without pagination.
// https://open.tapd.cn/document/api-doc/API文档/api_reference/workspace/projects.html
// https://open.tapd.cn/document/api-doc/API文档/api_reference/workspace/user_participant_projects.html
const COMPANY_PROJECTS = '/workspaces/projects'
const PARTICIPANT_PROJECTS = '/workspaces/user_participant_projects'
// https://open.tapd.cn/document/api-doc/API文档/api_reference/workspace/get_workspace_info.html
const WORKSPACE_INFO = '/workspaces/get_workspace_info'
// These field-definition endpoints expose status options for the given project.
// https://open.tapd.cn/document/api-doc/API文档/api_reference/story/get_story_fields_info.html
// https://open.tapd.cn/document/api-doc/API文档/api_reference/task/get_task_fields_info.html
const STORY_FIELDS = '/stories/get_fields_info'
const TASK_FIELDS = '/tasks/get_fields_info'
// The workflow status map supports stories, not tasks. The story category ID is required.
// https://open.tapd.cn/document/api-doc/API文档/api_reference/story/get_workitem_types.html
// https://open.tapd.cn/document/api-doc/API文档/api_reference/workflow/get_workflow_status_map.html
const STORY_TYPES = '/workitem_types'
const WORKFLOW_STATUSES = '/workflows/status_map'
const MAX_PROJECTS = 500
const MAX_STATUS_OPTIONS = 512
const MAX_STORY_TYPES = 8
const TIMEOUT_MS = 8_000
const ID = /^\d{1,32}$/u
const STATUS_KEY = /^[A-Za-z0-9_.-]{1,64}$/u
const CONTROL = /[\p{Cc}\u2028\u2029]/u

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const decimalId = value => Number.isSafeInteger(value) ? String(value) : value
const malformed = () => new TapdError('tapd/malformed')

function displayText(value) {
  if (typeof value !== 'string' || value.length > 1024 || CONTROL.test(value) || !value.trim()) throw malformed()
  return value.trim()
}

export const tapdNickname = z.string().trim().max(128).refine(value => !/[<>|;,\p{Cc}\u2028\u2029]/u.test(value))
export const requiredTapdNickname = tapdNickname.refine(value => value.length > 0)

// Keep the underlying error code/status while identifying a failure of nick-only project enumeration.
export class AutomaticProjectListError extends TapdError {}

async function lookupCurrentNickname(get) {
  try {
    const data = await get('/users/info')
    const nick = requiredTapdNickname.safeParse(isRecord(data) && Object.hasOwn(data, 'nick') ? data.nick : undefined)
    // The identity ID and any other fields are not needed or returned to the caller.
    if (nick.success) return nick.data
  } catch (error) {
    if (!(error instanceof TapdError) || !(error.status === 403 || error.status === 404
      || error.code === 'tapd/api' || error.code === 'tapd/malformed')) throw error
  }
  throw new TapdError('tapd/current-user-unavailable')
}

function projectCatalog(data, auto = false) {
  if (!Array.isArray(data)) throw malformed()
  const projects = new Map()
  for (const row of data.slice(0, MAX_PROJECTS)) {
    const workspace = isRecord(row) && Object.hasOwn(row, 'Workspace') ? row.Workspace : auto ? row : undefined
    if (!isRecord(workspace)) throw malformed()
    if (auto && workspace.category === 'organization') continue
    const id = decimalId(workspace.id)
    if (typeof id !== 'string' || !ID.test(id)) throw malformed()
    const name = displayText(workspace.name)
    if (projects.has(id) && projects.get(id) !== name) throw malformed()
    projects.set(id, name)
  }
  return {
    projects: Array.from(projects, ([id, name]) => ({ id, name })),
    ...(data.length > MAX_PROJECTS ? { truncated: true } : {}),
  }
}

export async function discoverProjects({ auth, auto = false, companyId, seedWorkspaceId, nick, authorization, signal, fetchImpl }) {
  const bearer = auth === 'bearer'
  const get = (path, params) => requestTapdData({ path, params, authorization, signal, fetchImpl, timeoutMs: TIMEOUT_MS })
  if (auto || (bearer && companyId === undefined && seedWorkspaceId === undefined)) {
    if (!bearer) throw new TapdError('tapd/invalid-input')
    // Jiangluowen623/dsh-plugin-tapd (src/tapd.ts) uses this PAT flow. The public
    // docs list /users/info for OAuth and document company_id as required for the list.
    const currentNick = await lookupCurrentNickname(get)
    try {
      const catalog = projectCatalog(await get(PARTICIPANT_PROJECTS, { nick: currentNick }), true)
      return { scope: 'participant', ...catalog, currentNick }
    } catch (error) {
      if (!(error instanceof TapdError)) throw error
      throw new AutomaticProjectListError(error.code, error)
    }
  }
  if (companyId === undefined) {
    const workspace = await readWorkspace(get, seedWorkspaceId)
    companyId = decimalId(workspace.company_id)
    if (typeof companyId !== 'string' || !ID.test(companyId)) throw malformed()
  }
  const params = bearer ? { company_id: companyId, nick } : { company_id: companyId, category: 'project' }
  const catalog = projectCatalog(await get(bearer ? PARTICIPANT_PROJECTS : COMPANY_PROJECTS, params))
  // Basic lists company projects, not the personal access rights of a TAPD member.
  return { ...catalog, companyId, scope: bearer ? 'participant' : 'company' }
}

async function readWorkspace(get, id) {
  const info = await get(WORKSPACE_INFO, { workspace_id: id })
  const workspace = isRecord(info) && Object.hasOwn(info, 'Workspace') ? info.Workspace : undefined
  if (!isRecord(workspace) || decimalId(workspace.id) !== id) throw malformed()
  return workspace
}

// Resolve known IDs without requiring permission to enumerate projects or identify the account.
export async function discoverProjectNames({ workspaceIds, authorization, signal, fetchImpl }) {
  const deadline = performance.now() + TIMEOUT_MS
  const projects = []
  let next = 0
  let stop = false
  async function worker() {
    while (!stop && !signal?.aborted && next < workspaceIds.length) {
      const timeoutMs = Math.floor(deadline - performance.now())
      if (timeoutMs < 1) break
      const id = workspaceIds[next++]
      try {
        const workspace = await readWorkspace((path, params) => requestTapdData({
          path, params, authorization, signal, fetchImpl, timeoutMs,
        }), id)
        projects.push({ id, name: displayText(workspace.name) })
      } catch (error) {
        if (!(error instanceof TapdError)) throw error
        if (error.status === 401 || error.code === 'tapd/rate-limit') stop = true
        // Errors for a single project don't discard names already read.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, workspaceIds.length) }, worker))
  if (signal?.aborted) throw new TapdError('tapd/aborted')
  return { projects }
}

function mergeStatusMap(data, options = new Map()) {
  if (!isRecord(data)) throw malformed()
  for (const key in data) {
    if (!Object.hasOwn(data, key)) continue
    if (!STATUS_KEY.test(key)) throw malformed()
    const label = displayText(data[key])
    if (options.has(key) && options.get(key) !== label) throw malformed()
    options.set(key, label)
    if (options.size > MAX_STATUS_OPTIONS) throw new TapdError('tapd/discovery-limit')
  }
  return options
}

const projectStatusOptions = options => Array.from(options, ([key, label]) => ({ key, label }))

function fieldStatusOptions(data) {
  if (!isRecord(data) || !Object.hasOwn(data, 'status') || !isRecord(data.status)
    || !Object.hasOwn(data.status, 'options')) throw malformed()
  return projectStatusOptions(mergeStatusMap(data.status.options))
}

async function workflowStoryOptions(get, workspaceId) {
  // Ask for one extra row so an incomplete catalog is never presented as complete.
  const types = await get(STORY_TYPES, {
    entity_type: 'story', fields: 'id,workspace_id,entity_type', limit: MAX_STORY_TYPES + 1, page: 1,
  })
  if (!Array.isArray(types)) throw malformed()
  if (types.length > MAX_STORY_TYPES) throw new TapdError('tapd/discovery-limit')
  const ids = new Set()
  for (const row of types) {
    const type = isRecord(row) && Object.hasOwn(row, 'WorkitemType') ? row.WorkitemType : undefined
    if (!isRecord(type) || decimalId(type.workspace_id) !== workspaceId || type.entity_type !== 'story') throw malformed()
    const id = decimalId(type.id)
    if (typeof id !== 'string' || !ID.test(id)) throw malformed()
    ids.add(id)
  }
  const options = new Map()
  for (const id of ids) {
    mergeStatusMap(await get(WORKFLOW_STATUSES, { system: 'story', workitem_type_id: id }), options)
  }
  return projectStatusOptions(options)
}

async function storyStatusOptions(get, workspaceId) {
  const deadline = performance.now() + TIMEOUT_MS
  try {
    return fieldStatusOptions(await get(STORY_FIELDS))
  } catch (error) {
    // A different documented definition can help when the field metadata is absent or
    // unreadable. Do not retry permission, TAPD API, network, quota or cancellation errors.
    if (!(error instanceof TapdError) || !(error.code === 'tapd/malformed'
      || (error.code === 'tapd/http' && (error.status === 404 || error.status === 405)))) throw error
  }
  return workflowStoryOptions((path, params) => {
    const remaining = Math.floor(deadline - performance.now())
    if (remaining < 1) throw new TapdError('tapd/timeout')
    return get(path, params, remaining)
  }, workspaceId)
}

export function discoveryErrorCode(error) {
  if (!(error instanceof TapdError)) return undefined
  return error.code === 'tapd/auth' && error.status === 403 ? 'tapd/discovery-forbidden' : error.code
}

export async function discoverStatuses({ workspaceId, authorization, signal, fetchImpl }) {
  if (typeof workspaceId !== 'string' || !ID.test(workspaceId)) throw new TapdError('tapd/invalid-input')
  const get = (path, params, timeoutMs = TIMEOUT_MS) => requestTapdData({
    path, params: { ...params, workspace_id: workspaceId }, authorization, signal, fetchImpl, timeoutMs,
  })
  const failures = []
  const track = promise => promise.catch(error => { failures.push(error); throw error })
  const [storyResult, taskResult] = await Promise.allSettled([
    track(storyStatusOptions(get, workspaceId)), track(get(TASK_FIELDS).then(fieldStatusOptions)),
  ])
  // Cancellation cancels the whole operation. If neither type is usable, preserve the
  // first failure as the existing RPC error rather than reporting an empty success.
  if (signal?.aborted) throw new TapdError('tapd/aborted')
  if (failures.length === 2) throw failures[0]
  const errors = {}
  const read = (kind, result) => {
    if (result.status === 'fulfilled') return result.value
    const code = discoveryErrorCode(result.reason)
    if (code === undefined) throw result.reason
    errors[kind] = code
    return []
  }
  const stories = read('stories', storyResult)
  const tasks = read('tasks', taskResult)
  const taskFailure = taskResult.status === 'rejected' ? taskResult.reason : undefined
  // The documented standard task statuses can be offered as unverified choices only
  // after the same project returned usable story metadata. Never mask an explicit auth,
  // rate-limit, network or server failure; this flag makes no claim about task access.
  const standardTaskOptions = stories.length > 0 && taskFailure && (
    ['tapd/api', 'tapd/malformed'].includes(taskFailure.code)
    || (taskFailure.code === 'tapd/http' && [400, 404, 405, 422, 501].includes(taskFailure.status)))
  return { stories, tasks, ...(failures.length ? { errors } : {}), ...(standardTaskOptions ? { standardTaskOptions: true } : {}) }
}
