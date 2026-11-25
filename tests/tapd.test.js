import assert from 'node:assert/strict';
import test from 'node:test';
import { requestTapdData, scanTapd, TapdError, tapdModifiedWindow } from '../tapd.js';

const SECRET = 'fake-secret-do-not-log';
const BASE = {
  workspaceId: '12345678',
  objectType: 'story',
  owner: 'alice',
  statuses: ['new', 'in_progress'],
  authorization: `Bearer ${SECRET}`,
};

function scan(options) {
  return scanTapd({ ...BASE, ...options });
}

function row(overrides = {}, wrapper = 'Story') {
  return {
    [wrapper]: {
      id: '1112345678000012345',
      workspace_id: BASE.workspaceId,
      name: 'Work item',
      owner: BASE.owner,
      status: 'new',
      description: '',
      due: '',
      ...overrides,
    },
  };
}

function page(...data) {
  return Response.json({ status: 1, data });
}

function isTapdError(code, status) {
  return (error) => {
    assert.ok(error instanceof TapdError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, new RegExp(SECRET));
    return true;
  };
}

test('Story and Task use different API endpoints, row wrappers, and canonical work-item URLs', async () => {
  for (const [objectType, plural, wrapper, authorization] of [
    ['story', 'stories', 'Story', BASE.authorization],
    ['task', 'tasks', 'Task', 'Basic dXNlcm5hbWU6cGFzc3dvcmQ='],
  ]) {
    let calls = 0;
    const items = await scan({
      objectType,
      authorization,
      baseUrl: 'https://not-tapd.invalid', // ignored, never controls the origin
      async fetchImpl(requestUrl, request) {
        calls += 1;
        const url = new URL(requestUrl);
        assert.equal(url.origin, 'https://api.tapd.cn');
        assert.equal(url.pathname, `/${plural}`);
        assert.equal(url.username + url.password + url.hash, '');
        assert.equal(request.method, 'GET');
        assert.equal(request.redirect, 'error');
        assert.equal(request.credentials, 'omit');
        assert.equal(request.body, undefined);
        const headers = new Headers(request.headers);
        assert.equal(headers.get('authorization'), authorization);
        assert.equal(headers.get('accept'), 'application/json');
        assert.equal(url.searchParams.get('workspace_id'), BASE.workspaceId);
        assert.equal(url.searchParams.get('owner'), 'USER_OR<alice>');
        assert.equal(url.searchParams.get('status'), 'new|in_progress');
        assert.equal(url.searchParams.get('order'), 'id desc');
        assert.equal(url.searchParams.get('limit'), '100');
        assert.equal(url.searchParams.get('page'), '1');
        assert.deepEqual([...url.searchParams.keys()].sort(), [
          'fields', 'limit', 'order', 'owner', 'page', 'status', 'workspace_id',
        ]);
        assert.ok(!requestUrl.includes(SECRET));
        return page(row({ url: 'https://not-tapd.invalid/' }, wrapper));
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(items, [{
      id: '1112345678000012345',
      title: 'Work item',
      description: '',
      url: `https://www.tapd.cn/${BASE.workspaceId}/prong/${plural}/view/1112345678000012345`,
    }]);
  }
  await assert.rejects(scan({ objectType: 'task', fetchImpl: async () => page(row()) }), isTapdError('tapd/malformed'));
});

test('qualifies only exact workspace, semicolon-delimited owner, and status matches', async () => {
  const items = await scan({
    fetchImpl: async () => page(
      row({ id: 2, owner: 'b;alice;c', status: 'in_progress' }),
      row({ id: 13, owner: 'alice2' }),
      row({ id: 11, owner: 'other;malice' }),
      row({ id: 15, owner: 'other;Alice' }),
      row({ id: 16, owner: 'other; alice' }),
      row({ id: 19, owner: 'other|alice' }),
      row({ id: 20, owner: 'alice,other' }),
      row({ id: 21, owner: '' }),
      row({ id: 17, status: 'newer' }),
      row({ id: 18, status: 'NEW' }),
      row({ id: 14, status: 'new ', v_status: 'new' }),
      row({ id: 23, workspace_id: '012345678' }),
      row({ id: 12, workspace_id: '12345679' }),
      row({ id: 10, workspace_id: 12345678 }),
    ),
  });
  assert.deepEqual(items.map(({ id }) => id), ['10', '2']);
});

test('rolling windows use Asia/Shanghai time and are independently enforced for stories and tasks', async () => {
  const modifiedWindow = tapdModifiedWindow(7, Date.parse('2026-11-20T17:05:06.987Z'));
  assert.deepEqual(modifiedWindow, { from: '2026-11-14 01:05:06', to: '2026-11-21 01:05:06' });
  assert.equal(tapdModifiedWindow(undefined), undefined);
  assert.throws(() => tapdModifiedWindow(366), isTapdError('tapd/invalid-input'));
  for (const [objectType, wrapper] of [['story', 'Story'], ['task', 'Task']]) {
    const items = await scan({ objectType, modifiedWindow, fetchImpl: async (request) => {
      const { searchParams: params } = new URL(request);
      assert.equal(params.get('modified'), '2026-11-14 01:05:06~2026-11-21 01:05:06');
      assert.ok(params.get('fields').split(',').includes('modified'));
      // TAPD may ignore a filter; only verified timestamps enter the import plan.
      return page(row({ id: '1', modified: '2026-11-14 01:05:05' }, wrapper),
        row({ id: '2', modified: modifiedWindow.from }, wrapper),
        row({ id: '3', modified: modifiedWindow.to }, wrapper),
        row({ id: '4', modified: '2026-11-21 01:05:07' }, wrapper),
        row({ id: '5', owner: 'different person' }, wrapper));
    } });
    assert.deepEqual(items.map(item => item.id), ['3', '2']);
  }
  await assert.rejects(scan({ modifiedWindow, fetchImpl: async () => page(row({ modified: '2026-02-30 01:05:06' })) }),
    isTapdError('tapd/malformed'));
  await assert.rejects(scan({ modifiedWindow: { from: modifiedWindow.to, to: modifiedWindow.from },
    fetchImpl: async () => assert.fail('invalid time ranges cannot reach TAPD') }), isTapdError('tapd/invalid-input'));
});

test('the shared read transport only allows official fixed read paths', async () => {
  for (const path of ['/workspaces/update_workspace_info', '//example.test/stories', '/stories?other=1', '/stories/../tasks']) {
    await assert.rejects(requestTapdData({ path, authorization: BASE.authorization,
      fetchImpl: async () => assert.fail('unexpected network call') }), isTapdError('tapd/invalid-input'));
  }
});

test('converts HTML to plain text without embedded media or link destinations', async () => {
  let calls = 0;
  const [item] = await scan({
    async fetchImpl() {
      calls += 1;
      return page(row({
        description: '<p>Build &amp; test</p><p><a href="javascript:alert(1)">Instructions</a>'
          + '<img src="https://evil.invalid/tracker" alt="tracker"><iframe src="https://evil.invalid">frame</iframe>'
          + '<script>bad()</script><style>.bad {}</style><svg><text>icon</text></svg>'
          + '<a href="https://evil.invalid/"> More</a></p>',
      }));
    },
  });
  assert.equal(calls, 1);
  assert.equal(item.description, 'Build & test\n\nInstructions More');
});

test('emits optional dueDate only for an exact, calendar-valid date', async () => {
  const inputs = [
    '2024-02-29', '2026-02-29', '2026-04-31', '2025-13-01', '2026-10-21T00:00:00Z',
    '2026-11-01 00:00:00', '2026-2-01', '2026-11-01 ', '0000-00-00', '', null, undefined,
  ];
  const items = await scan({
    fetchImpl: async () => page(...inputs.map((due, index) => row({ id: 100 - index, due }))),
  });
  assert.equal(items[0].dueDate, '2024-02-29');
  assert.ok(items.slice(1).every((item) => !Object.hasOwn(item, 'dueDate')));
});

function fullPage(number, size = 100) {
  return page(...Array.from({ length: size }, (_, index) => row({
    id: String(10_000 - number * 100 - index),
    owner: 'not-alice', // full raw pages must be paginated even when no matches survive
  })));
}

test('serially paginates raw results until a short page and returns exact numeric ID order', async () => {
  const pages = [];
  const items = await scan({
    async fetchImpl(url, init) {
      const current = Number(new URL(url).searchParams.get('page'));
      pages.push(current);
      assert.equal(new Headers(init.headers).get('Authorization'), BASE.authorization);
      if (current === 1) return fullPage(current);
      return page(
        row({ id: Number.MAX_SAFE_INTEGER }),
        row({ id: '9007199254740999' }),
        row({ id: '9007199254740992' }),
      );
    },
  });
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(items.map(({ id }) => id), ['9007199254740999', '9007199254740992', '9007199254740991']);
});

test('a full tenth page rejects the entire scan even when local matches are empty', async () => {
  const pages = [];
  await assert.rejects(scan({
    async fetchImpl(url) {
      const current = Number(new URL(url).searchParams.get('page'));
      pages.push(current);
      return fullPage(current);
    },
  }), isTapdError('tapd/scan-limit'));
  assert.deepEqual(pages, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('accepts a short tenth page as complete', async () => {
  const pages = [];
  const items = await scan({
    async fetchImpl(url) {
      const current = Number(new URL(url).searchParams.get('page'));
      pages.push(current);
      return current < 10 ? fullPage(current) : page(row({ id: 2 }));
    },
  });
  assert.deepEqual(pages, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(items.map(({ id }) => id), ['2']);
});

test('invalid inputs cannot trigger network, operator injection, or credential header injection', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return page(); };
  for (const options of [
    { workspaceId: '1&password=x' }, { workspaceId: Number.MAX_SAFE_INTEGER + 1 },
    { objectType: 'https://not-tapd.invalid' }, { owner: '' }, { owner: 'alice|bob' },
    { owner: 'alice;bob' }, { owner: 'NOT_EQ<alice>' }, { owner: 'ali\u0000ce' },
    { statuses: ['new|done'] }, { statuses: new Array(1) }, { statuses: [null] },
    { statuses: 'new' }, { authorization: '' }, { authorization: SECRET },
    { authorization: `${BASE.authorization}\r\nOther: secret` },
  ]) {
    await assert.rejects(scan({ ...options, fetchImpl }), isTapdError('tapd/invalid-input'));
  }
  assert.deepEqual(await scan({ statuses: [], fetchImpl }), []);
  assert.equal(called, false);
});

test('auth, redirect, and other HTTP errors never read response bodies or retry', async () => {
  for (const [status, code] of [[401, 'tapd/auth'], [403, 'tapd/auth'], [302, 'tapd/http'], [500, 'tapd/http']]) {
    let calls = 0;
    let bodyReads = 0;
    await assert.rejects(scan({
      async fetchImpl(_, { redirect }) {
        calls += 1;
        assert.equal(redirect, 'error');
        return {
          status,
          headers: new Headers({ Location: 'https://not-tapd.invalid' }),
          json() { bodyReads += 1; throw Error(SECRET); },
        };
      },
    }), isTapdError(code, status));
    assert.equal(calls, 1);
    assert.equal(bodyReads, 0);
  }
});

test('429 parses Retry-After seconds and dates, omits invalid values, and never retries', async () => {
  const now = Date.now();
  const future = new Date(now + 60_000);
  const cases = [
    ['42', (delay) => assert.equal(delay, 42_000)],
    [future.toUTCString(), (delay) => assert.ok(delay >= 58_000 && delay <= 60_000)],
    ['Thu, 01 Jan 1970 00:00:00 GMT', (delay) => assert.equal(delay, 0)],
    ['1.5', (delay) => assert.equal(delay, undefined)],
    ['9999999999999999999', (delay) => assert.equal(delay, undefined)],
    [undefined, (delay) => assert.equal(delay, undefined)],
  ];
  for (const [header, verifyDelay] of cases) {
    let calls = 0;
    await assert.rejects(scan({
      async fetchImpl() {
        calls += 1;
        return new Response(SECRET, { status: 429, headers: header ? { 'retry-after': header } : {} });
      },
    }), (error) => {
      verifyDelay(error.retryAfterMs);
      return isTapdError('tapd/rate-limit', 429)(error);
    });
    assert.equal(calls, 1);
  }
});

test('bounds both waiting for response headers and consuming the response body', { timeout: 1000 }, async () => {
  for (const blockBody of [false, true]) {
    const never = new Promise(() => {});
    let requestSignal;
    await assert.rejects(scan({
      timeoutMs: 15,
      async fetchImpl(_, { signal }) {
        requestSignal = signal;
        return blockBody ? { status: 200, json: () => never } : never;
      },
    }), isTapdError('tapd/timeout'));
    assert.equal(requestSignal.aborted, true);
  }
});

test('caller cancellations are distinct from timeout and do not expose abort reasons', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(scan({
    signal: controller.signal,
    async fetchImpl(_, { signal }) {
      calls += 1;
      assert.equal(signal.aborted, false);
      controller.abort(new Error(SECRET));
      return page(row());
    },
  }), isTapdError('tapd/aborted'));
  await assert.rejects(scan({
    signal: controller.signal,
    async fetchImpl() { calls += 1; return page(row()); },
  }), isTapdError('tapd/aborted'));
  assert.equal(calls, 1);
});

test('network, API, and malformed body failures do not expose remote error content', async () => {
  await assert.rejects(scan({ fetchImpl: async () => { throw new Error(SECRET); } }), isTapdError('tapd/network'));
  await assert.rejects(scan({ fetchImpl: async () => Response.json({ status: 0, info: SECRET }) }), isTapdError('tapd/api'));
  for (const response of [
    new Response(SECRET), Response.json([]), Response.json({ status: 1, data: SECRET }),
    Response.json({ status: true, data: [] }), Response.json({ status: '1', data: [] }),
    page(...Array.from({ length: 101 }, () => row())),
  ]) {
    await assert.rejects(scan({ fetchImpl: async () => response }), isTapdError('tapd/malformed'));
  }
});

test('malformed rows fail the whole scan, even after valid rows or outside the selector', async () => {
  for (const invalid of [
    null, {}, row({ id: Number.MAX_SAFE_INTEGER + 1 }), row({ id: 1.5 }), row({ id: '10?secret=x' }),
    row({ workspace_id: undefined }), row({ owner: undefined }), row({ owner: [BASE.owner] }),
    row({ status: 1 }), row({ name: '' }), row({ description: [SECRET] }),
    row({ workspace_id: '2', id: SECRET }),
  ]) {
    await assert.rejects(scan({ fetchImpl: async () => page(row(), invalid) }), isTapdError('tapd/malformed'));
  }
});
