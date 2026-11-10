/* Conditional search destinations explain a selection; they never change
 * the global probability field. Two terrain-following strokes are shared
 * with the reverse-origin layer. */
(function(root){
 'use strict';
 const D=typeof module!=='undefined'?require('./probability-display.js'):root.CrateProbabilityDisplay;
 const P=typeof module!=='undefined'?require('./probability.js'):root.CrateProbability;
 const defaults=Object.freeze({outerEnabled:true,outerWidth:4,outerColor:'#174bba',outerDashed:true,innerEnabled:true,innerWidth:2,innerColor:'#76cfff',innerDashed:true});
 const badgeDefaults=Object.freeze({badgeOpacity:.85,badgeNearOpacity:0,badgeFadeEnabled:true,badgeFadeRadius:25,badgeGap:20,badgeAvoidance:0});
 const widths=new Map(),setting=(settings,key)=>Number.isFinite(settings?.[key])?settings[key]:badgeDefaults[key];
 function badgeOpacity(box,pointer,settings=badgeDefaults){const base=setting(settings,'badgeOpacity'),radius=setting(settings,'badgeFadeRadius');let value=base;
  if(pointer&&Number.isFinite(pointer.x)&&Number.isFinite(pointer.y)&&settings.badgeFadeEnabled!==false&&radius>0){const distance=Math.hypot(Math.max(box.x-pointer.x,0,pointer.x-box.x-box.w),Math.max(box.y-pointer.y,0,pointer.y-box.y-box.h))*(pointer.screenScale||1),t=Math.min(1,distance/radius),smooth=t*t*(3-2*t);value=setting(settings,'badgeNearOpacity')+(base-setting(settings,'badgeNearOpacity'))*smooth;}
  return Math.max(0,Math.min(1,value));
 }
 function badgePosition(anchor,size,area,labels,settings=badgeDefaults,screenScale=1){const unit=1/(screenScale>0?screenScale:1),gap=setting(settings,'badgeGap')*unit,padding=setting(settings,'badgeAvoidance')*unit,{w,h}=size;let best=null;
  for(let ring=0;ring<4;ring++){const distance=gap+ring*(h+padding+12*unit),positions=[[anchor.x-w/2,anchor.top-distance-h],[anchor.right+distance,anchor.y-h/2],[anchor.x-w/2,anchor.bottom+distance],[anchor.left-distance-w,anchor.y-h/2]];
   for(const [x,y]of positions){const box={x:Math.max(area.x+4,Math.min(area.x+area.w-w-4,x)),y:Math.max(area.y+4,Math.min(area.y+area.h-h-4,y)),w,h};let count=0,overlap=0;
    for(const label of labels){const width=Math.min(box.x+w,label.x+label.w+padding)-Math.max(box.x,label.x-padding),height=Math.min(box.y+h,label.y+label.h+padding)-Math.max(box.y,label.y-padding);if(width>0&&height>0){count++;overlap+=width*height;}}
    if(!best||count<best.count||count===best.count&&overlap<best.overlap)best={...box,count,overlap};
   }if(best.count===0)break;
  }return best;
 }
 function stroke(ctx,path,settings=defaults){ctx.save();ctx.lineJoin='round';ctx.lineCap='round';for(const name of ['outer','inner'])if(settings[name+'Enabled']!==false&&settings[name+'Width']>0){path();ctx.lineWidth=settings[name+'Width'];ctx.strokeStyle=settings[name+'Color'];ctx.setLineDash(settings[name+'Dashed']?[7,5]:[]);ctx.stroke();}ctx.restore();}
 function active(state,options){return options.transfers!==false&&state.selected&&state.outgoing?.key===state.selected.y*512+state.selected.x&&(options.heatmap||options.values)?state.outgoing:null;}
 function targets(state,options){const outgoing=active(state,options);return outgoing?new Map(outgoing.destinations.map(v=>[v.key,v])):null;}
 function label(value,retry){return retry?'0×('+((root.CrateI18n?.t||((s)=>s))('重抽'))+')':Number(value).toFixed(1)+'×';}
 function render(ctx,state,area,display,options,surface){const outgoing=active(state,options),boxes=[];if(!outgoing)return boxes;
  const settings=options.selectionOutline||defaults,scale=state.scale,size=P.labelSize(scale,options.labelSize||12,options.paletteColors),font=`${options.labelWeight||400} ${size}px "Microsoft YaHei",sans-serif`;
  const draw=(c,probability,retry,origin=false)=>{
   const x=state.x+(c.px+(c.labelOffset?.[0]||0))*scale,y=state.y+(c.py+(c.labelOffset?.[1]||0))*scale;
   if(x<area.x-100||x>area.x+area.w+100||y<area.y-130||y>area.y+area.h+130)return;
   const rings=surface(c),path=()=>{ctx.beginPath();for(const ring of rings){ring.forEach(([dx,dy],i)=>ctx[i?'lineTo':'moveTo'](state.x+(c.px+dx)*scale,state.y+(c.py+dy)*scale));ctx.closePath();}};
   if(!origin)stroke(ctx,path,settings);
   if(!origin&&30*scale<26)return;
   const value=display.get(c)?.multiplier||0,text=label(value,retry),second=probability===null?null:'('+D.percent(probability)+')';
   ctx.save();ctx.font=font;ctx.textAlign='center';ctx.lineJoin='round';ctx.strokeStyle='rgba(12,25,34,.9)';ctx.lineWidth=P.labelStrokeWidth(size,options.paletteColors);ctx.fillStyle=P.labelColor(value,options.palette,display.maxMultiplier,options.colorText!==false,options.paletteColors);
   const yy=y+(second?-size*.2:size/3);ctx.strokeText(text,x,yy);ctx.fillText(text,x,yy);if(second){ctx.strokeText(second,x,yy+size*1.15);ctx.fillText(second,x,yy+size*1.15);}
   if(options.collectLabelBoxes!==false){const measure=text=>{const key=font+'|'+text;if(!widths.has(key)){if(widths.size>=512)widths.delete(widths.keys().next().value);widths.set(key,ctx.measureText(text).width);}return widths.get(key);},width=Math.max(measure(text),second?measure(second):0),pad=ctx.lineWidth/2+2;boxes.push({x:x-width/2-pad,y:yy-size-pad,w:width+2*pad,h:size*(second?2.4:1.25)+2*pad});}ctx.restore();
  };
  if(outgoing.retryHere)draw(state.selected,null,true,true);
  for(const entry of outgoing.destinations){if(outgoing.retryHere&&entry.key===outgoing.key)continue;const c=state.lookup.get(entry.cell.x+','+entry.cell.y)||entry.cell;draw(c,entry.transferProbability,c.status!=='crate');}
  return boxes;
 }
 const api={defaults,badgeDefaults,badgeOpacity,badgePosition,stroke,active,targets,label,render};root.CrateSelectionProbability=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
