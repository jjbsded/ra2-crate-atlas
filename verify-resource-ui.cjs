'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(__dirname+'/resource-ui.js','utf8');

function harness(){
 const elements=new Map(),requests=[];
 function element(id){
  if(elements.has(id))return elements.get(id);
  const listeners=new Map(),e={value:'',textContent:'',disabled:false,open:false,
   classList:{toggle(){}},addEventListener(name,fn){listeners.set(name,fn);},
   emit(name){listeners.get(name)?.({});},showModal(){this.open=true;},
   close(){this.open=false;this.emit('close');}};
  elements.set(id,e);return e;
 }
 element('version').value='auto';
 const document={getElementById:element,activeElement:null};
 const context=vm.createContext({document,window:{},fetch:(url,options)=>new Promise((resolve,reject)=>{
  requests.push({url,options,resolve:data=>resolve({ok:true,json:async()=>data}),reject});
 })});
 vm.runInContext(fs.readFileSync(__dirname+'/local-api.js','utf8'),context);
 vm.runInContext(code,context);
 const mod=root=>({root,ready:!!root,configured:!!root,reason:'目录：'+root});
 const state=root=>({ready:{ra2:true,yr:true},mod:mod(root)});
 return {element,document,requests,mod,state,api:context.window.CrateResourceUI};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

async function main(){
 const h=harness(),e=h.element;
 h.requests.shift().resolve(h.state('old'));await settle();
 const resolving=h.api.resolve('auto');h.requests.shift().resolve(h.state('old'));
 assert.equal(await resolving,'directory','automatic mode must use the saved directory');
 const applying=[];h.api.onApplied=version=>applying.push(version);
 const opening=e('resourcesOpen').onclick(),refresh=h.requests.shift();
 e('modRoot').value='edited';e('modRoot').emit('input');
 h.document.activeElement=e('resourceClose'); // The user has left the input.
 refresh.resolve(h.state('old'));await opening;
 assert.equal(e('modRoot').value,'edited','a delayed refresh must not replace an edited draft after blur');

 e('resourceCancel').onclick();
 const reopening=e('resourcesOpen').onclick(),oldRead=h.requests.shift();
 e('modRoot').value='new';e('modRoot').emit('input');
 const saving=e('resourceClose').onclick(),write=h.requests.shift();
 assert.equal(JSON.parse(write.options.body).root,'new');
 write.resolve(h.mod('new'));await saving;
 assert.equal(e('version').value,'directory');
 assert.deepEqual(applying,['directory'],'saving must activate directory resources and reanalyze');
 assert.equal(e('resourceDialog').open,false);
 oldRead.resolve(h.state('old'));await reopening;
 assert.equal(e('modStatus').textContent,'目录：new','a pre-save read must not roll back the displayed saved state');
 const third=e('resourcesOpen').onclick(),thirdRead=h.requests.shift();
 assert.equal(e('modRoot').value,'new','reopening must use the saved directory');
 thirdRead.resolve(h.state('new'));await third;

 e('resourceCancel').onclick();
 const stale=e('resourcesOpen').onclick(),staleRead=h.requests.shift();
 e('resourceCancel').onclick();
 const current=e('resourcesOpen').onclick(),currentRead=h.requests.shift();
 currentRead.resolve(h.state('new'));await current;
 staleRead.reject(Error('old request failed'));await stale;
 assert.equal(e('resourceError').textContent,'','a closed dialog request must not overwrite the current dialog');

 const early=harness(),f=early.element,initial=early.requests.shift();
 const firstOpen=f('resourcesOpen').onclick(),firstRead=early.requests.shift();
 f('modRoot').value='new';f('modRoot').emit('input');
 const earlySave=f('resourceClose').onclick();early.requests.shift().resolve(early.mod('new'));await earlySave;
 initial.resolve(early.state('old'));await settle();
 firstRead.resolve(early.state('old'));await firstOpen;
 assert.equal(f('modStatus').textContent,'目录：new');
 f('version').value='yr';f('version').emit('change');
 assert.match(f('resourceSummary').textContent,/已就绪/,'saving before the first read must not lose stock-resource readiness');
 const selecting=e('modBrowse').onclick(),pick=h.requests.shift();
 assert.equal(pick.url,'/api/resources/directory');
 assert.equal(e('modSave').disabled,true);
 pick.resolve({cancelled:false,path:'D:\\游戏\\时空'});await selecting;
 assert.equal(e('modRoot').value,'D:\\游戏\\时空');
 assert.equal(h.requests.length,0,'choosing a folder must not implicitly save it');
 assert.equal(e('modSave').disabled,false);
 const cancelling=e('modBrowse').onclick();h.requests.shift().resolve({cancelled:true,path:null});await cancelling;
 assert.equal(e('modRoot').value,'D:\\游戏\\时空','cancelling the native dialog preserves the draft');
 const failure=e('modBrowse').onclick();h.requests.shift().reject(TypeError('Failed to fetch'));await failure;
 assert.match(e('resourceError').textContent,/无法连接本地工具服务/);
 assert.equal(e('modRoot').value,'D:\\游戏\\时空');
 assert.equal(e('modBrowse').disabled,false,'network errors must release the browse button');
 const lateOpen=e('resourcesOpen').onclick(),lateRead=h.requests.shift();
 const picking=e('modBrowse').onclick();h.requests.shift().resolve({cancelled:false,path:'D:\\新的目录'});
 await picking;lateRead.resolve(h.state('old'));await lateOpen;
 assert.equal(e('modRoot').value,'D:\\新的目录','an earlier settings read must not erase the native selection');
 const clearing=e('modClear').onclick();h.requests.shift().resolve(h.mod(''));await clearing;
 assert.equal(e('version').value,'yr');
 assert.deepEqual(applying,['directory','yr']);
 const stock=h.api.resolve('auto');h.requests.shift().resolve(h.state(''));
 assert.equal(await stock,'yr');
 const explicit=h.api.resolve('ra2');h.requests.shift().resolve(h.state('new'));
 assert.equal(await explicit,'ra2','explicit stock selection overrides the saved directory');
 console.log('PASS: directory drafts survive delayed reads; saves supersede stale reads; closed-dialog errors are ignored; initial stock checks are retained.');
 console.log('PASS: native folder selection fills only the draft; cancellation/network failure preserve it; stale reads cannot overwrite it.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
