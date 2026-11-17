import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { build } from '../upstream/node_modules/esbuild/lib/main.js';
import { chromium } from '../upstream/node_modules/playwright-core/index.mjs';

// Real shipped React renderer, storage and ShadowRoot; only the host API is doubled.
const root = resolve(import.meta.dirname, '../release/ui-recheck');
await mkdir(root, { recursive: true });
await build({
  stdin: { resolveDir: resolve(import.meta.dirname, '..'), loader: 'tsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {App,connect} from './dist/host-app/app.js';
    const originalFetch=window.fetch;
    window.requests=[];
    const api={
      listModels:async()=>[{id:'host::fixture',name:'Fixture',provider:'Yomni',vision:false,efforts:['none'],defaultEffort:'none'}],
      pickWorkspaceDirectory:async()=> 'C:/canvas-work',
      requestConversation:async input=>{window.requests.push(input);return {sessionId:'fixture-session'};},
      snapshot:async()=>({conversation:{sessionId:'fixture-session',messages:[{role:'assistant',text:'Native answer'}],run:{status:'completed'}}}),
      action:async(_action,value)=>{
        const input=JSON.parse(value);
        const result={conversations:[],messages:[{role:'assistant',text:'Native answer'}],run:{status:'completed'}};
        return {view:{data:{bridgeResult:{id:input.id,value:result}}}};
      },
      openSettings:async()=>{},
    };
    const shadow=document.getElementById('host').attachShadow({mode:'open'});
    const element=document.createElement('div');element.className='thoughtdag-host';shadow.append(element);
    element.innerHTML='<style>'+await (await fetch('/canvas.css')).text()+'</style><div id="app" style="width:100%;height:100%"></div>';
    let connection=connect(api,element,'light','zh-CN');
    await connection.ready;
    createRoot(element.querySelector('#app')).render(<App/>);
    window.changeTheme=mode=>{connection.cleanup();connection=connect(api,element,mode,'zh-CN');};
    window.fetchUnchanged=()=>window.fetch===originalFetch;
  ` },
  bundle:true,format:'esm',outfile:resolve(root,'fixture.js'),
});
await writeFile(resolve(root,'canvas.css'),await readFile(resolve(import.meta.dirname,'../ui/canvas.css')));
await writeFile(resolve(root,'index.html'),'<!doctype html><html lang="en"><body style="margin:0"><div id="host" style="width:100vw;height:100vh"></div><script type="module" src="/fixture.js"></script></body></html>');
const server=createServer(async(request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    const file=resolve(root,`.${pathname==='/'?'/index.html':pathname}`);
    if(!file.startsWith(root+sep))throw new Error('Outside test root');
    response.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(file)]??'application/octet-stream');
    response.end(await readFile(file));
  }catch{response.writeHead(404);response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:850}});
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('button',{name:'My Canvas',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'My Canvas',exact:true}).click();
  await page.getByRole('button',{name:'新建画布',exact:true}).click();
  await page.getByRole('button',{name:'Untitled',exact:true}).waitFor();
  const question=page.getByPlaceholder('你想探索什么？',{exact:true});
  await question.fill('Native fixture question');
  await question.press('Enter');
  await page.getByText('Native answer',{exact:true}).first().waitFor();
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>window.requests[0].content),'Native fixture question');
  assert.equal(await page.evaluate(()=>window.fetchUnchanged()),true);
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  await page.screenshot({path:resolve(root,'light.png')});
  await page.evaluate(()=>window.changeTheme('dark'));
  await page.locator('.thoughtdag-host[data-theme="dark"]').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({path:resolve(root,'dark.png')});
  await page.setViewportSize({width:800,height:600});
  await page.getByRole('button',{name:'Fit View',exact:true}).click();
  await page.waitForTimeout(600);
  await page.screenshot({path:resolve(root,'dark-narrow.png')});
  // Allow the real debounced IDB write to finish before a hard navigation.
  await page.waitForTimeout(1200);
  await page.reload();
  await page.getByText('Native answer',{exact:true}).first().waitFor();
  assert.deepEqual(errors,[]);
  process.stdout.write('ThoughtDAG host renderer: ShadowRoot menus, native generation, persistence, themes and narrow viewport passed.\n');
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
