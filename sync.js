import { randomUUID } from 'node:crypto'

// TaskService v1: ../tavlo-plugins-tasks/docs/task-service.md (External sources and retries).
const identityFields = ['provider', 'connectionId', 'scopeId', 'objectType', 'objectId']
const isTapdId = value => typeof value === 'string' && /^[0-9]{1,32}$/.test(value)
const isObjectType = value => value === 'story' || value === 'task'
const sameSource = (ref, identity) => !!ref && identityFields.every(field => ref[field] === identity[field])
const defaultRetryAfterMs = 60_000

class SyncFailure extends Error {
  constructor(code, retryAfterMs) {
    super(code)
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
}

function safeFailure(error, fallback) {
  const status = error?.status ?? error?.statusCode
  if (status === 429 || error?.code === 'tapd/rate-limit') {
    const delay = error?.retryAfterMs
    return new SyncFailure('rate-limit', Number.isFinite(delay) && delay >= 0 ? delay : defaultRetryAfterMs)
  }
  if (fallback === 'scan-failed') {
    if (status === 401 || status === 403 || error?.code === 'tapd/auth') return new SyncFailure('auth')
    if (status === 408 || error?.code === 'tapd/timeout') return new SyncFailure('timeout')
    if (error?.code === 'tapd/scan-limit') return new SyncFailure('scan-limit')
    if (error?.code === 'tapd/aborted') return new SyncFailure('aborted')
  } else if (fallback === 'task-failed') {
    if (error?.code === 'tasks/limit-reached') return new SyncFailure('task-capacity')
    if (error?.code === 'tasks/persistence-unknown') return new SyncFailure('task-write-unknown')
    if (error?.code === 'tasks/workspace-unavailable') return new SyncFailure('workspace-unavailable')
  }
  return new SyncFailure(fallback)
}

function supported(capabilities) {
  const { contractVersion, operations, features, limits } = capabilities ?? {}
  return contractVersion === 1 && Array.isArray(operations)
    && operations.includes('create') && operations.includes('list')
    && ['externalRef', 'externalRefUnique', 'filteredList'].every(feature => features?.[feature] === true)
    && Number.isSafeInteger(limits?.maxTitleLength) && limits.maxTitleLength > 0
    && Number.isSafeInteger(limits?.maxBriefLength) && limits.maxBriefLength >= 0
}

function sourceUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || value.length > 2048 || /[\x00-\x20\x7f<>\\]/.test(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch { return false }
}

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

function clip(text, limit) {
  // Limits are UTF-16 lengths; a cap must not cut a surrogate pair in two.
  return text.slice(0, limit).replace(/[\ud800-\udbff]$/, '').trimEnd()
}

function newInput(row, identity, limits, targetWorkspaceId) {
  const title = row.title.toWellFormed().replace(/\s+/g, ' ').trim() || `TAPD ${row.id}`
  const target = row.url.replaceAll('&', '&amp;')
  const source = [`[Open in TAPD](<${target}>)`, `[TAPD](<${target}>)`, `<${row.url}>`]
    .find(link => link.length <= limits.maxBriefLength) ?? ''
  // scan already converts HTML to plain text (no raw TAPD HTML). An indented
  // Markdown code block keeps that text literal, including images, links and
  // autolinks. Put the connector's own link first so truncation can't break it.
  const description = row.description.toWellFormed().replace(/\r\n?/g, '\n').trim()
  const brief = clip(description ? `${source ? `${source}\n\n` : ''}${description.replace(/^/gm, '    ')}` : source, limits.maxBriefLength)
  return {
    requestId: `tapd.${randomUUID()}`,
    title: clip(title, limits.maxTitleLength) || 'T',
    brief,
    externalRef: { ...identity, url: row.url },
    ...(targetWorkspaceId ? { workspaceId: targetWorkspaceId } : {}),
    ...(dateOnly(row.dueDate) ? { dueDate: row.dueDate } : {}),
  }
}

function reportData(scope) {
  return {
    workspaceId: isTapdId(scope?.workspaceId) ? scope.workspaceId : undefined,
    objectType: isObjectType(scope?.objectType) ? scope.objectType : undefined,
    code: 'ok', scanned: 0, candidates: 0, created: 0, duplicates: 0, suppressed: 0, failed: 0,
  }
}

/**
 * Run a single round. The caller serializes rounds for the persistent connection and owns scheduling.
 * `report`, if supplied, is a synchronous observer called once per reached scope with safe IDs,
 * a stable code and counts. `candidates` includes pending replays that could still create a task;
 * `created` counts successful create acknowledgements even if the subsequent ledger write fails.
 */
export async function syncRound({ tasks, ledger, connectionId, scopes, maxNewPerScope, authorization, scan, signal, report, hasWorkspace }) {
  function notify(data) {
    try { report?.(data) } catch { /* Reporting is observational. */ }
  }

  function checkAbort() {
    if (signal?.aborted) throw new SyncFailure('aborted')
  }

  async function checked(action, fallback) {
    checkAbort()
    try {
      const value = await action()
      checkAbort()
      return value
    } catch (error) {
      checkAbort()
      throw safeFailure(error, fallback)
    }
  }

  const execute = (operation, input) => checked(() => tasks.execute(operation, input, signal), 'task-failed')
  const put = (key, record) => checked(() => ledger.put(key, record), 'ledger-failed')
  const markImported = key => put(key, { kind: 'imported' })

  if (signal?.aborted) return {}
  let capabilities
  try {
    capabilities = await checked(() => tasks.capabilities(), 'unsupported-tasks')
    if (!supported(capabilities) || typeof tasks.execute !== 'function') throw new SyncFailure('unsupported-tasks')
  } catch (error) {
    if (!signal?.aborted) {
      const failure = error instanceof SyncFailure ? error : safeFailure(error, 'unsupported-tasks')
      for (const scope of scopes) {
        notify({ ...reportData(scope), code: failure.code, failed: 1 })
        if (failure.code === 'rate-limit' || signal?.aborted) break
      }
      if (failure.code === 'rate-limit') return { retryAfterMs: failure.retryAfterMs }
    }
    return {}
  }

  for (const scope of scopes) {
    if (signal?.aborted) break
    const data = reportData(scope)
    let stop
    function failed(error, fallback) {
      const failure = error instanceof SyncFailure ? error : safeFailure(error, fallback)
      const halts = failure.code === 'aborted' || failure.code === 'rate-limit'
      data.failed++
      // Preserve the first ordinary failure; a stop condition takes precedence.
      if (data.code === 'ok' || halts) data.code = failure.code
      if (halts) stop = failure
    }

    try {
      if (!data.workspaceId || !data.objectType) throw new SyncFailure('scan-failed')
      const { targetWorkspaceId, ...query } = scope
      const rows = await checked(() => scan({ ...query, authorization, signal }), 'scan-failed')
      if (!Array.isArray(rows)) throw new SyncFailure('scan-failed')
      data.scanned = rows.length
      const seen = new Set()
      const plan = []
      for (const row of rows) {
        if (!isTapdId(row?.id) || typeof row.title !== 'string' || typeof row.description !== 'string' || !sourceUrl(row.url)) {
          throw new SyncFailure('scan-failed')
        }
        if (seen.has(row.id)) {
          data.duplicates++
          continue
        }
        seen.add(row.id)
        const identity = { provider: 'tapd', connectionId, scopeId: scope.workspaceId, objectType: scope.objectType, objectId: row.id }
        const key = `${scope.workspaceId}:${scope.objectType}:${row.id}`
        const record = await checked(() => ledger.get(key), 'ledger-failed')
        if (record?.kind === 'imported') {
          data.duplicates++
          continue
        }
        if (record != null && (record.kind !== 'pending' || !sameSource(record.input?.externalRef, identity))) {
          throw new SyncFailure('ledger-failed')
        }
        // External identity excludes the URL. A local edit or different URL cannot defeat dedupe.
        const result = await execute('list', { externalRef: identity, limit: 1 })
        if (result?.ok !== true) throw safeFailure(result?.error, 'task-failed')
        const hits = result.value?.tasks
        if (!Array.isArray(hits) || hits.some(task => !sameSource(task?.externalRef, identity))) {
          throw new SyncFailure('task-failed')
        }
        if (hits.length) {
          data.duplicates++
          plan.push({ key })
        } else {
          data.candidates++
          plan.push({ key, row, identity, pending: record?.input })
        }
      }

      // No writes whatsoever (including import markers or replays) before the
      // entire scope has been scanned and its possible creates counted.
      if (!Number.isSafeInteger(maxNewPerScope) || maxNewPerScope < 0 || data.candidates > maxNewPerScope) {
        data.code = 'scope-limit'
      } else {
        let workspaceAvailable
        for (const { key, row, identity, pending } of plan) {
          try {
            if (row) {
              // Reject a missing destination before persisting a new immutable intent.
              // A replay must retain its original input regardless of today's mapping.
              if (!pending && targetWorkspaceId && hasWorkspace) {
                workspaceAvailable ??= await checked(() => hasWorkspace(targetWorkspaceId), 'workspace-unavailable')
                if (!workspaceAvailable) throw new SyncFailure('workspace-unavailable')
              }
              const input = pending ?? newInput(row, identity, capabilities.limits, targetWorkspaceId)
              // Persist the whole immutable intent before asking TaskService to create.
              if (!pending) await put(key, { kind: 'pending', input })
              const result = await execute('create', input)
              if (result?.ok === true) {
                // A replay may return the already-created task in its current, unbound form.
                if (pending && !sameSource(result.value?.task?.externalRef, identity)) data.suppressed++
                else data.created++
              } else if (result?.error?.code === 'tasks/deleted') {
                data.suppressed++
              } else if (result?.error?.code === 'tasks/external-conflict' && result.error.details?.reason === 'duplicate') {
                // V1 explicitly confirms an exact duplicate under its write lock.
                data.duplicates++
              } else {
                // Keep the pending record unchanged; the next round can retry the same request.
                throw safeFailure(result?.error, 'task-failed')
              }
            }
            await markImported(key)
          } catch (error) {
            failed(error, 'task-failed')
            if (stop) break
          }
        }
      }
    } catch (error) {
      failed(error, 'scan-failed')
    }
    notify(data)
    if (stop?.code === 'rate-limit') return { retryAfterMs: stop.retryAfterMs }
    if (stop) break
  }
  return {}
}
