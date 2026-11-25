// Run after npm run build. Set PLAYWRIGHT_MODULE and, optionally, BROWSER_EXE.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const path = process.env.PLAYWRIGHT_MODULE || require.resolve('playwright-core')
const { chromium } = await import(pathToFileURL(resolve(path)).href)
const fixture = execFileSync(process.execPath, [fileURLToPath(new URL('prepare-browser-smoke.mjs', import.meta.url)), '--zh'], { encoding: 'utf8' }).trim()
const output = resolve(process.env.TAPD_BROWSER_OUTPUT || '../artifacts/tapd-settings-0.4.4/browser')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXE || undefined, headless: true })
const report = []
try {
  for (const width of [1000, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, locale: 'zh-CN', reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' })
    const errors = [], network = []
    await context.route(/^https?:/, route => { network.push(route.request().url()); return route.abort() })
    const page = await context.newPage()
    page.setDefaultTimeout(6000)
    page.on('pageerror', error => errors.push(error.message))
    const standardTasks = width === 390
    await page.goto(standardTasks ? `${fixture}?standard` : fixture)
    const projectStep = page.locator('section').filter({ has: page.getByRole('heading', { name: '选择同步项目', exact: true }) }).last()
    const connectStep = page.locator('section').filter({ has: page.getByRole('heading', { name: '连接 TAPD', exact: true }) }).last()
    await page.getByLabel('个人访问令牌', { exact: true }).fill('smoke-token')
    assert.equal(await connectStep.getByText('TAPD 项目或工作项链接', { exact: true }).count(), 0)
    assert.equal(await projectStep.getByLabel('TAPD 项目或工作项链接', { exact: true }).isVisible(), false)
    await page.getByRole('button', { name: '其他添加方式' }).click()
    await projectStep.getByLabel('TAPD 项目或工作项链接', { exact: true }).waitFor()
    await page.getByRole('button', { name: '其他添加方式' }).click()
    await page.getByRole('button', { name: '添加项目', exact: true }).click()
    const picker = projectStep.getByRole('combobox', { name: 'TAPD 项目', exact: true })
    const workspace = projectStep.getByRole('combobox', { name: 'DSH 工作区', exact: true })
    await picker.waitFor()
    assert.equal(await projectStep.locator('.tapd-project-fields').first().locator(':scope > .tapd-field').count(), 2)
    const a = await picker.boundingBox(), b = await workspace.boundingBox()
    assert(a && b)
    assert(width === 1000 ? a.x + a.width + 8 <= b.x : a.y + a.height + 6 <= b.y, `Fields overlap at ${width}: ${JSON.stringify({ a, b })}`)
    await workspace.click()
    await page.getByRole('option', { name: '产品研发', exact: true }).click()
    await picker.fill('不存在的项目')
    await projectStep.getByText('没有符合搜索条件的项目。').waitFor()
    await picker.press('Escape')
    assert.equal(await picker.getAttribute('aria-expanded'), 'false')
    await picker.fill('9876')
    const match = projectStep.getByRole('option', { name: /平台支持/ })
    await match.waitFor()
    assert.equal(await projectStep.getByRole('option').count(), 1)
    await page.screenshot({ path: resolve(output, `project-picker-${width}.png`) })
    if (width === 1000) {
      await picker.press('ArrowDown')
      assert.equal(await picker.getAttribute('aria-activedescendant'), await match.getAttribute('id'))
      await picker.press('Enter')
      assert(await picker.evaluate(el => el === document.activeElement))
    } else await match.click()
    assert.equal(await picker.inputValue(), '平台支持')
    assert.equal(await picker.getAttribute('aria-expanded'), 'false')
    if (standardTasks) {
      await projectStep.getByText(/以下为 TAPD 标准选项/).waitFor()
      const inProgress = projectStep.getByRole('checkbox', { name: '进行中', exact: true })
      assert.equal(await inProgress.isChecked(), false)
      await inProgress.check()
    } else {
      await projectStep.getByText(/当前凭据没有读取状态的权限/).waitFor()
      assert.equal(await projectStep.getByRole('checkbox', { name: '进行中', exact: true }).count(), 0)
    }
    await projectStep.getByRole('checkbox', { name: '规划中', exact: true }).check()
    assert.equal(await projectStep.getByText(/状态键|\bplanning\b/).count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    await page.screenshot({ path: resolve(output, `status-options-${width}.png`) })
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await projectStep.getByRole('heading', { name: '平台支持', exact: true }).waitFor()
    const calls = await page.evaluate(() => window.smokeCalls.map(({ operation, input }) => ({ operation,
      ...(['discover-statuses', 'save'].includes(operation) ? { workspaceId: input.workspaceId, projects: input.config?.projects } : {}),
      ...(operation === 'discover-project-names' ? { workspaceIds: input.workspaceIds } : {}),
    })))
    assert.deepEqual(calls, [
      { operation: 'get' }, { operation: 'discover-projects' }, { operation: 'discover-statuses', workspaceId: '9876', projects: undefined },
      { operation: 'save', workspaceId: undefined, projects: [{ workspaceId: '9876', targetWorkspaceId: '8b0ea114-564d-4d1c-a60f-3c6a5d181ddb', stories: ['planning'], tasks: standardTasks ? ['progressing'] : [] }] },
      { operation: 'discover-project-names', workspaceIds: ['9876'] },
    ])
    await page.goto(`${fixture}?known`)
    const saved = projectStep.getByRole('group', { name: '产品迭代', exact: true })
    const unavailable = projectStep.getByRole('group', { name: '项目 2', exact: true })
    await saved.getByText('#1234', { exact: true }).waitFor()
    await unavailable.getByText('暂时读不到 TAPD 项目名称，仍可使用项目 ID。').waitFor()
    assert.equal(await unavailable.getByLabel('TAPD 项目 ID', { exact: true }).inputValue(), '5555')
    await page.screenshot({ path: resolve(output, `saved-project-names-${width}.png`) })
    const missingId = unavailable.getByLabel('TAPD 项目 ID', { exact: true })
    await missingId.fill('9876')
    assert.deepEqual(await page.evaluate(() => window.smokeCalls.map(({ operation }) => operation)), ['get', 'discover-project-names'])
    await missingId.press('Enter')
    await projectStep.getByRole('group', { name: '平台支持', exact: true }).getByText('#9876', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.smokeCalls.filter(({ operation }) => operation === 'discover-project-names')
      .map(({ input }) => input.workspaceIds)), [['1234', '5555'], ['1234', '9876']])
    assert.deepEqual(errors, []); assert.deepEqual(network, [])
    report.push({ width, projectControl: a, workspaceControl: b, standardTasks, storyOptionsWhenTaskStatusReadFails: true, savedProjectNames: true })
    await context.close()
  }
} finally {
  await browser.close()
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ pass: report.length === 2, layouts: report }, null, 2) + '\n')
}
console.log('TAPD browser regression passed at 1000 and 390 CSS pixels')
