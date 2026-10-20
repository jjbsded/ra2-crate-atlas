/* Offline rendering: shared Canvas2D scene -> ffmpeg H.264. No screen capture. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),{spawn}=require('child_process');
const bundledDeps=path.join(__dirname,'runtime/node/node_modules');
const deps=process.env.CODEX_NODE_MODULES||(fs.existsSync(bundledDeps)?bundledDeps:path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'));
function runtimeRequire(name){try{return require(name);}catch{return require(path.join(deps,name));}}
const {createCanvas,GlobalFonts,loadImage}=runtimeRequire('@napi-rs/canvas');
for(const font of ['msyh.ttc','msyhbd.ttc']){const p=path.join(process.env.WINDIR||'C:/Windows','Fonts',font);if(fs.existsSync(p))GlobalFonts.registerFromPath(p,'Microsoft YaHei');}
const M=require('./model.js'),S=require('./scene.js'),H=require('./probability.js'),T=require('./timing.js'),D=require('./probability-display.js');
require('./asset-data.js');
const args=process.argv.slice(2),config=args[0]?JSON.parse(fs.readFileSync(args[0],'utf8')):{all:true};
const out=path.resolve(args[1]||path.join(__dirname,'output/crate-generation-demo.mp4'));
const progressFile=args[2];
const timing=T.settings(config.timing),heatmap=H.settings(config.heatmap),traces=(config.all?M.CORE_PRESETS.map(p=>M.buildTrace({preset:p,frame:config.options?.frame??600})):[M.buildTrace(config.options||{})]).map(trace=>T.apply(H.decorate(trace),timing));
const fps=24,duration=traces.reduce((a,t)=>a+t.duration,0),count=Math.ceil(duration*fps);
const canvas=createCanvas(S.WIDTH,S.HEIGHT),ctx=canvas.getContext('2d');
fs.mkdirSync(path.dirname(out),{recursive:true});
const bundledFfmpeg=path.join(__dirname,'runtime/ffmpeg/ffmpeg.exe');
const ffmpeg=process.env.FFMPEG_PATH||(fs.existsSync(bundledFfmpeg)?bundledFfmpeg:'ffmpeg');
const video=spawn(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',`${S.WIDTH}x${S.HEIGHT}`,'-r',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',out],{windowsHide:true});
let errorText='';video.stderr.on('data',d=>errorText+=d);video.on('error',e=>{console.error(e.message);process.exitCode=1;});
const finished=new Promise((resolve,reject)=>video.on('close',code=>code===0?resolve():reject(Error(errorText||`ffmpeg exit ${code}`))));
video.stdin.on('error',()=>{});
function report(percent){if(progressFile)fs.writeFileSync(progressFile,JSON.stringify({progress:percent}));else if(percent%10===0)console.log(`${percent}%`);}
async function writeFrame(buffer){if(!video.stdin.write(buffer))await new Promise((resolve,reject)=>{video.stdin.once('drain',resolve);video.stdin.once('error',reject);}).finally(()=>video.stdin.removeAllListeners('error'));}
(async()=>{
 const images=await Promise.all(Object.entries(globalThis.CrateAssetData).map(async([name,asset])=>[name,await loadImage(Buffer.from(asset.data.split(',')[1],'base64'))]));
 S.setAssets(Object.fromEntries(images),globalThis.CrateAssetData);
 let base=0,chapter=0,lastPct=-1,lastKey='',buffer;
 for(let i=0;i<count;i++){
  const absolute=i/fps;while(chapter<traces.length-1&&absolute>=base+traces[chapter].duration){base+=traces[chapter].duration;chapter++;}
  const trace=traces[chapter],state=M.atTime(trace,absolute-base);
  const scan=state.step.phase==='search'?Math.ceil(state.progress*state.step.visits.length):0;
  const cacheKey=`${chapter}/${state.step.i}/${scan}`;
  if(cacheKey!==lastKey){S.render(ctx,trace,state.step,state.progress,{chapter:`场景 ${chapter+1} / ${traces.length}`,coords:config.coords===true,heatmap:state.step.phase==='heatmap'?heatmap:{...heatmap,enabled:false,filter:'all'},heatmapValues:config.heatmapValues!==false});buffer=Buffer.from(ctx.getImageData(0,0,S.WIDTH,S.HEIGHT).data);lastKey=cacheKey;
   if(state.step.phase==='done')fs.writeFileSync(path.join(path.dirname(out),`scene-${trace.preset.id}.png`),canvas.toBuffer('image/png'));
   if(state.step.phase==='heatmap')fs.writeFileSync(path.join(path.dirname(out),`heatmap-${trace.preset.id}.png`),canvas.toBuffer('image/png'));
  }
  await writeFrame(buffer);const pct=Math.floor(i/count*100);if(pct!==lastPct){report(pct);lastPct=pct;}
 }
 video.stdin.end();await finished;report(100);
 const annotatedTraces=traces.map(t=>({...t,probability:{...t.probability,display:D.demo(t.probability).metadata,cells:Object.fromEntries(Object.entries(t.probability.cells).map(([k,c])=>[k,{...c,...D.demo(t.probability).exportCell(c)}]))}}));
 fs.writeFileSync(out.replace(/\.mp4$/i,'.json'),JSON.stringify({resolution:[S.WIDTH,S.HEIGHT],fps,duration,frames:count,timing,heatmap,coords:config.coords===true,heatmapValues:config.heatmapValues!==false,scope:'指定起点的平地机制演示；热力图按全部起点计算；不是游戏 RNG 或实机录像',traces:annotatedTraces},null,2));
 const stamp=t=>{const ms=Math.round(t*1000),h=Math.floor(ms/3600000),m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
 let subtitleIndex=0,offset=0,subtitles=[];
 for(const trace of traces){for(const s of trace.steps)subtitles.push(`${++subtitleIndex}\n${stamp(offset+s.start)} --> ${stamp(offset+s.end)}\n${s.title}\n${s.text}\n`);offset+=trace.duration;}
 fs.writeFileSync(out.replace(/\.mp4$/i,'.srt'),subtitles.join('\n'),'utf8');
 console.log(out);
})().catch(e=>{video.kill();console.error(e.stack);process.exitCode=1;});
