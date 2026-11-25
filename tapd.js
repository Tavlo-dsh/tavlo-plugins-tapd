// The TAPD list request and work-item URL handling are adapted from
// dsh-task-hub's lib/tapd.js (MIT); see licenses/dsh-task-hub.md.
import { compile } from 'html-to-text';

const TAPD_API = 'https://api.tapd.cn';
const READ_PATHS = new Set([
  '/stories', '/tasks', '/stories/get_fields_info', '/tasks/get_fields_info',
  '/workitem_types', '/workflows/status_map',
  '/workspaces/projects', '/workspaces/user_participant_projects', '/workspaces/get_workspace_info', '/users/info',
]);
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 20_000;
const ITEM_FIELDS = 'id,name,description,workspace_id,status,owner,due';

const toPlainText = compile({
  wordwrap: false,
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    ...['img', 'svg', 'iframe', 'object', 'embed', 'audio', 'video', 'script', 'style']
      .map((selector) => ({ selector, format: 'skip' })),
  ],
});

const ERROR_MESSAGES = {
  'tapd/invalid-input': 'Invalid TAPD scan settings.',
  'tapd/auth': 'TAPD authentication failed.',
  'tapd/rate-limit': 'TAPD rate limit reached.',
  'tapd/http': 'TAPD returned an HTTP error.',
  'tapd/network': 'Could not reach TAPD.',
  'tapd/aborted': 'TAPD scan was cancelled.',
  'tapd/timeout': 'TAPD request timed out.',
  'tapd/malformed': 'TAPD returned a malformed response.',
  'tapd/api': 'The TAPD API reported an error.',
  'tapd/current-user-unavailable': 'TAPD could not provide a usable current-user nickname.',
  'tapd/scan-limit': 'TAPD scan reached the page limit without a complete result.',
};

export class TapdError extends Error {
  constructor(code, { status, retryAfterMs } = {}) {
    super(ERROR_MESSAGES[code] ?? 'TAPD scan failed.');
    this.name = 'TapdError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

function decimalId(value) {
  // TAPD IDs can exceed Number.MAX_SAFE_INTEGER, so never coerce strings to Number.
  const id = Number.isSafeInteger(value) ? String(value) : value;
  return typeof id === 'string' && /^\d{1,32}$/.test(id) ? id : null;
}

function isQueryLiteral(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
    && !/[|;<>\p{Cc}\u2028\u2029]/u.test(value);
}

function isAuthorization(value) {
  return typeof value === 'string' && value.trim() === value
    && !/[^\x20-\x7e]/.test(value) && /^[a-z][a-z0-9+.-]* +\S/i.test(value);
}

function retryAfterDelay(response) {
  const value = response.headers?.get('Retry-After')?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1000;
    return Number.isSafeInteger(delay) ? delay : undefined;
  }
  // Date.parse accepts many non-HTTP strings (including fractional numbers).
  const time = Date.parse(value);
  if (Number.isFinite(time) && new Date(time).toUTCString() === value) {
    return Math.max(0, time - Date.now());
  }
  return undefined;
}

function cancelBody(response) {
  // Non-success responses are never read or logged.
  void response.body?.cancel().catch(() => {});
}

async function readData(url, authorization, signal, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url.href, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authorization },
      redirect: 'error',
      credentials: 'omit',
      signal,
    });
  } catch (error) {
    throw new TapdError(error?.name === 'TimeoutError' ? 'tapd/timeout' : 'tapd/network');
  }

  const status = response?.status;
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new TapdError('tapd/malformed');
  }
  if (response.redirected || status < 200 || status >= 300) {
    cancelBody(response);
    if (status === 401 || status === 403) throw new TapdError('tapd/auth', { status });
    if (status === 429) {
      throw new TapdError('tapd/rate-limit', { status, retryAfterMs: retryAfterDelay(response) });
    }
    throw new TapdError('tapd/http', { status });
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new TapdError('tapd/malformed');
  }
  if (!isRecord(body) || !Number.isInteger(body.status)) throw new TapdError('tapd/malformed');
  if (body.status !== 1) throw new TapdError('tapd/api');
  if (!Object.hasOwn(body, 'data')) throw new TapdError('tapd/malformed');
  return body.data;
}

async function requestData(url, authorization, signal, fetchImpl, timeoutMs) {
  if (signal?.aborted) throw new TapdError('tapd/aborted');
  const timeout = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(new TapdError(timeout.signal.aborted ? 'tapd/timeout' : 'tapd/aborted'));
    requestSignal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    // Bound both the request and body consumption, even with an injected fetch adapter.
    return await Promise.race([aborted, readData(url, authorization, requestSignal, fetchImpl)]);
  } finally {
    clearTimeout(timer);
    requestSignal.removeEventListener('abort', onAbort);
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Host-only, read-only transport for fixed official TAPD paths. */
export async function requestTapdData({
  path, params, authorization, signal, fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  if (!READ_PATHS.has(path) || !isAuthorization(authorization) || typeof fetchImpl !== 'function'
    || (signal != null && !(signal instanceof AbortSignal)) || !Number.isInteger(timeoutMs)
    || timeoutMs < 1 || timeoutMs > REQUEST_TIMEOUT_MS) throw new TapdError('tapd/invalid-input');
  const url = new URL(path, TAPD_API);
  url.search = new URLSearchParams(params);
  return requestData(url, authorization, signal, fetchImpl, timeoutMs);
}

function validateRow(row, wrapper) {
  if (!isRecord(row) || !Object.hasOwn(row, wrapper) || !isRecord(row[wrapper])) {
    throw new TapdError('tapd/malformed');
  }
  const item = row[wrapper];
  const id = decimalId(item.id);
  const workspace = decimalId(item.workspace_id);
  if (!id || !workspace || typeof item.name !== 'string' || !item.name.trim()
    || typeof item.owner !== 'string' || typeof item.status !== 'string' || !item.status.trim()
    || (item.description != null && typeof item.description !== 'string')
    || (item.due != null && typeof item.due !== 'string')) {
    throw new TapdError('tapd/malformed');
  }
  return { item, id, workspace };
}

function dateOnly(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

function normalizeItem(item, id, workspace, collection) {
  let description;
  try {
    description = toPlainText(item.description ?? '');
  } catch {
    throw new TapdError('tapd/malformed');
  }
  const dueDate = dateOnly(item.due);
  return {
    id,
    title: item.name.trim(),
    description,
    ...(dueDate === undefined ? {} : { dueDate }),
    url: `https://www.tapd.cn/${encodeURIComponent(workspace)}/prong/${collection}/view/${encodeURIComponent(id)}`,
  };
}

// TAPD's API uses timezone-less wall-clock timestamps. Use China standard time
// explicitly so a DSH Host's local timezone (and DST) cannot shift the window.
const DAY_MS = 86_400_000;
const CHINA_OFFSET_MS = 8 * 3_600_000;
function tapdClock(ms) {
  return new Date(ms + CHINA_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

function readTapdClock(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) || value.startsWith('0000-')) return NaN;
  const stamp = Date.parse(`${value.replace(' ', 'T')}+08:00`);
  return Number.isFinite(stamp) && tapdClock(stamp) === value ? stamp : NaN;
}

export function tapdModifiedWindow(lookbackDays, nowMs = Date.now()) {
  if (lookbackDays === undefined) return undefined;
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 365 || !Number.isFinite(nowMs)) {
    throw new TapdError('tapd/invalid-input');
  }
  const now = Math.floor(nowMs / 1000) * 1000;
  return { from: tapdClock(now - lookbackDays * DAY_MS), to: tapdClock(now) };
}

function compareIdDescending(left, right) {
  const a = BigInt(left.id);
  const b = BigInt(right.id);
  return a > b ? -1 : a < b ? 1 : 0;
}

/** Read one complete, bounded list. A failed or truncated scan never returns a partial list. */
export async function scanTapd({
  workspaceId, objectType, owner, statuses, authorization, signal, modifiedWindow,
  fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const workspace = decimalId(workspaceId);
  const statusSet = Array.isArray(statuses) ? new Set(statuses) : null;
  if (!workspace || (objectType !== 'story' && objectType !== 'task') || !isQueryLiteral(owner)
    || !statusSet || ![...statusSet].every(isQueryLiteral) || !isAuthorization(authorization)
    || typeof fetchImpl !== 'function' || (signal != null && !(signal instanceof AbortSignal))
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > REQUEST_TIMEOUT_MS) {
    throw new TapdError('tapd/invalid-input');
  }
  if (signal?.aborted) throw new TapdError('tapd/aborted');
  const from = readTapdClock(modifiedWindow?.from);
  const to = readTapdClock(modifiedWindow?.to);
  if (modifiedWindow !== undefined && (!Number.isFinite(from) || !Number.isFinite(to) || from > to)) {
    throw new TapdError('tapd/invalid-input');
  }
  if (statusSet.size === 0) return [];

  const [collection, wrapper] = objectType === 'story' ? ['stories', 'Story'] : ['tasks', 'Task'];
  const params = new URLSearchParams({
    workspace_id: workspace,
    // USER_OR interprets each literal as a member of TAPD's multi-user field.
    owner: `USER_OR<${owner}>`,
    status: [...statusSet].join('|'),
    limit: String(PAGE_SIZE),
    fields: modifiedWindow ? `${ITEM_FIELDS},modified` : ITEM_FIELDS,
    order: 'id desc',
  });
  if (modifiedWindow) params.set('modified', `${modifiedWindow.from}~${modifiedWindow.to}`);

  const items = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    params.set('page', String(page));
    const rows = await requestTapdData({ path: `/${collection}`, params, authorization, signal, fetchImpl, timeoutMs });
    if (!Array.isArray(rows) || rows.length > PAGE_SIZE) throw new TapdError('tapd/malformed');
    if (rows.length === PAGE_SIZE && page === MAX_PAGES) throw new TapdError('tapd/scan-limit');
    for (const row of rows) {
      const { item, id, workspace: rowWorkspace } = validateRow(row, wrapper);
      // Never rely on the remote filter to enforce the configured import scope.
      if (rowWorkspace !== workspace || !item.owner.split(';').includes(owner) || !statusSet.has(item.status)) continue;
      if (modifiedWindow) {
        const updated = readTapdClock(item.modified);
        if (!Number.isFinite(updated)) throw new TapdError('tapd/malformed');
        if (updated < from || updated > to) continue;
      }
      items.push(normalizeItem(item, id, workspace, collection));
    }
    if (rows.length < PAGE_SIZE) return items.sort(compareIdDescending);
  }
}
