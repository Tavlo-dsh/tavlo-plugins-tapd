// Creates a disposable local page that runs the packaged client with real React
// and a mocked DSH slot/RPC. No profile, browser account, or network is needed.
import { build } from 'esbuild'
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const locale = process.argv.includes('--zh') ? 'zh' : 'en'
const rotation = process.argv.includes('--rotation')
const folder = await mkdtemp(join(tmpdir(), 'tapd-arc-smoke-'))
await build({
  stdin: { contents: String.raw`
    import React from 'react';
    import * as JSX from 'react/jsx-runtime';
    import * as ReactDOM from 'react-dom';
    import {createRoot} from 'react-dom/client';
    const modules = {'react': React, 'react/jsx-runtime': JSX, 'react-dom': ReactDOM};
    const zh = __SMOKE_LOCALE__ === 'zh';
    const workspaces = [{id:'8b0ea114-564d-4d1c-a60f-3c6a5d181ddb',title:zh?'产品研发':'Example workspace',path:'C:/example'}];
    const known = location.search === '?known';
    let config = { enabled:false, auth:'bearer', owner:'', intervalSeconds:300, maxNewPerScope:25, projects:known ? [
      { workspaceId: '1234', stories: ['planning'], tasks: [] }, { workspaceId: '5555', stories: [], tasks: [] },
    ] : [] };
    // --rotation starts with a saved credential (never projected) and holds project discovery until released.
    let savedCredential = __SMOKE_ROTATION__ || known;
    let revision = 3;
    window.smokeCalls = [];
    window.__ModuleLoader__ = { load({factory}) {
      const plugin = factory(name => {
        if (!Object.hasOwn(modules,name)) throw Error('Unexpected browser module: '+name);
        return modules[name];
      });
      let translator;
      const rpc = async (_path,_method,payload) => {
        const {operation,input} = payload;
        window.smokeCalls.push({operation,input: input.credentials?.mode === 'replace'
          ? {...input,credentials:{mode:'replace'}} : input});
        const view = () => ({revision,source:savedCredential?'visual':'profile',configured:savedCredential,
          credentialSource:savedCredential?'visual':'none',syncState:'disabled',workspaceStatus:'ready',workspaces,config});
        if (operation === 'get') return {ok:true,value:view()};
        if (operation === 'save' || operation === 'save-credentials') {
          if (input.expectedRevision !== revision) return {ok:false,error:{code:'tapd/revision-conflict'}};
          if (operation === 'save') config = input.config;
          else config = {...config,auth:input.auth};
          if (input.credentials) savedCredential = input.credentials.mode === 'replace';
          revision++;
          return {ok:true,value:view()};
        }
        if (operation === 'discover-projects') {
          if (input.auto && !savedCredential && input.credentials?.token !== 'smoke-token') return {ok:false,error:{code:'tapd/invalid-credentials'}};
          if (__SMOKE_ROTATION__) await new Promise(resolve => { window.finishProjectLookup = resolve; });
          return {ok:true,value:{...(payload.input?.auto ? {currentNick:zh?'示例用户':'Alice'} : {companyId:'42'}),
            scope:'participant',projects:[{id:'1234',name:zh?'产品迭代':'Example project'},{id:'9876',name:zh?'平台支持':'Search target'}]}};
        }
        if (operation === 'discover-project-names') return {ok:true,value:{projects:[
          {id:'1234',name:zh?'产品迭代':'Example project'},{id:'9876',name:zh?'平台支持':'Search target'},
        ].filter(row => input.workspaceIds.includes(row.id))}};
        if (payload.operation === 'discover-statuses') return {ok:true,value:{stories:[{key:'open',label:zh?'待开始':'Open'},{key:'planning',label:zh?'规划中':'Planning'}],
           ...(payload.input.workspaceId === '9876' ? (location.search === '?standard'
             ? {tasks:[],errors:{tasks:'tapd/api'},standardTaskOptions:true}
             : {tasks:[],errors:{tasks:'tapd/discovery-forbidden'}}) : {tasks:[{key:'progressing',label:zh?'进行中':'In progress'}]})}};
        throw Error('Unexpected smoke RPC operation: '+payload.operation);
      };
      plugin.apply({
        effect: fn => fn(), locale: {register(_id,dictionary) {translator = dictionary[__SMOKE_LOCALE__];}},
        slots: {inject: (_name,fn) => fn(), register(_descriptor,render) {
          const t = (key, values = {}) => translator[key].replace(/\{(\w+)\}/g, (_match,name) => values[name]);
          createRoot(document.getElementById('root')).render(render({t,view:'page'}));
        }}, connection:{rpc:{call:rpc}},
      });
    } };
  `, resolveDir: root },
  outfile: join(folder, 'bootstrap.js'), bundle: true, platform: 'browser', format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"', __SMOKE_LOCALE__: JSON.stringify(locale), __SMOKE_ROTATION__: JSON.stringify(rotation) },
  minify: true,
})
await copyFile(join(root, 'lib/client.js'), join(folder, 'client.js'))
const page = join(folder, 'index.html')
await writeFile(page, `<!doctype html>
<html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>TAPD Arc component smoke</title>
<style>
:root { --dsw-alias-bg-base:#fff; --dsw-alias-bg-layer-2:#edf1f8; --dsw-alias-label-primary:#17243c;
  --dsw-alias-label-secondary:#42536f; --dsw-alias-border-l3:#9ca7ba; --dsw-alias-brand-primary:#235bc0; }
@media(prefers-color-scheme:dark) { :root { --dsw-alias-bg-base:#21252b; --dsw-alias-bg-layer-2:#323940;
  --dsw-alias-label-primary:#f4f7ff; --dsw-alias-label-secondary:#becad8; --dsw-alias-border-l3:#728398;
  --dsw-alias-brand-primary:#9ab9ff; color-scheme:dark; } }
body { margin:1rem auto; max-width:50rem; padding:0 1rem; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font:14px system-ui; }
</style>
<div id="root"></div><script src="bootstrap.js"></script><script src="client.js"></script>`)
console.log(pathToFileURL(page).href)
