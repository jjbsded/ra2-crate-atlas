'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.SIM_BASE||'http://127.0.0.1:8799/';assert.notEqual(new URL(base).port,'8767');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage(),file='/output/map-22309489b5d3/result.json';let session;
 p.on('response',async r=>{if(r.url().endsWith('/simulation-live/open')&&r.ok())session=(await r.json()).session;});
 await p.goto(base+'maps.html?result='+file);await p.waitForFunction(()=>window.CrateMapViewer?.state.liveEditing,null,{timeout:120000});assert(session);
 const api=await browser.newContext();
 const status=async id=>{const r=await api.request.post(base+'api/maps/simulation-live/sources',{data:{session:id,revision:-1}});return r.json();};
 const released=async id=>{let last;for(let i=0;i<30;i++){last=await status(id);if(last.reason==='released-by-client')return;await new Promise(r=>setTimeout(r,100));}assert.equal(last.reason,'released-by-client');};
 const old=session;await p.reload();await p.waitForFunction(()=>window.CrateMapViewer?.state.liveEditing,null,{timeout:120000});assert.notEqual(session,old);
 await released(old);const next=session;await p.close();await released(next);
 // Hold the open response so the page can leave while its server-side warmup exists.
 const q=await browser.newPage();let pending;const ready=new Promise(resolve=>{pending=resolve;});let held,lease;
 await q.route('**/api/maps/simulation-live/open',async route=>{lease=route.request().postDataJSON().lease;held=await route.fetch();pending();await new Promise(r=>setTimeout(r,500));try{await route.fulfill({response:held});}catch{}});
 await q.goto(base+'maps.html?result='+file);await ready;const orphan=(await held.json()).session;await q.close();await released(orphan);
 console.log('PASS reload, page close and pending warmup release their sessions',lease);await api.close();
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
