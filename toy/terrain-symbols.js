/* Small original geometric symbols shared by all official Toy maps. */
(function(root){
 'use strict';
 function path(ctx,p){ctx.beginPath();p.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](x,y));ctx.closePath();}
 function polygon(ctx,p,color){path(ctx,p);ctx.fillStyle=color;ctx.fill();}
 function line(ctx,p,color,width=1){ctx.beginPath();p.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](x,y));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
 function symbol(ctx,kind,x,y,scale=1){
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.lineJoin='round';ctx.lineCap='round';
  const dark='#233b43',light='#e7ebe0',gold='#eac46f';
  if(['building','oil','repair','hospital','armory','lab','tech'].includes(kind)){
   polygon(ctx,[[-11,-4],[0,2],[11,-4],[0,-10]],'#b1b6a6');
   polygon(ctx,[[-11,-4],[0,2],[0,-13],[-11,-19]],'#727f7b');
   polygon(ctx,[[0,2],[11,-4],[11,-19],[0,-13]],'#536b6d');
   polygon(ctx,[[-11,-19],[0,-25],[11,-19],[0,-13]],kind==='building'?'#bac2b0':gold);
   if(kind==='oil'){
    line(ctx,[[-10,-5],[0,-37],[10,-5]],dark,3);line(ctx,[[-5,-20],[5,-20]],light,2);
    line(ctx,[[-9,-31],[11,-36]],dark,3);line(ctx,[[7,-35],[10,-17]],dark,2);
   }else if(kind==='repair'){
    line(ctx,[[-5,-26],[6,-17]],dark,2.5);line(ctx,[[1,-26],[5,-27],[7,-23],[4,-21]],dark,2.5);
   }else if(kind==='hospital'){
    line(ctx,[[-5,-19],[5,-19]],'#aa3e40',3);line(ctx,[[0,-24],[0,-14]],'#aa3e40',3);
   }else if(kind==='lab'){
    line(ctx,[[-2,-29],[2,-29],[2,-24],[7,-18],[-7,-18],[-2,-24],[-2,-29]],dark,1.5);
   }else if(kind==='tech'||kind==='armory'){
    polygon(ctx,[[0,-25],[5,-19],[0,-14],[-5,-19]],dark);
   }else{line(ctx,[[-7,-13],[-3,-11]],light,2);line(ctx,[[4,-9],[8,-11]],light,2);}
  }else if(kind==='drill'){
   polygon(ctx,[[-10,-4],[0,2],[10,-4],[0,-10]],'#808b8e');
   polygon(ctx,[[-6,-7],[0,-29],[6,-7]],gold);
   line(ctx,[[0,-27],[0,-3]],dark,2);line(ctx,[[-8,-18],[8,-18]],dark,2);
   line(ctx,[[-8,-8],[8,-8]],light,2);
  }else if(kind==='scenery'){
   polygon(ctx,[[-8,-2],[0,2],[8,-2],[0,-6]],'#738681');
   polygon(ctx,[[-8,-2],[-8,-10],[0,-6],[0,2]],'#9ca99c');
   polygon(ctx,[[-8,-10],[0,-14],[8,-10],[0,-6]],'#c5cbb9');
  }else if(kind==='tree'){
   line(ctx,[[0,0],[0,-16]],'#6c6046',3);
   polygon(ctx,[[-10,-7],[10,-7],[0,-24]],'#416c51');polygon(ctx,[[-8,-14],[8,-14],[0,-30]],'#5b825c');
  }else if(kind==='rock'){
   polygon(ctx,[[-10,-3],[-7,-14],[3,-19],[11,-7],[7,0]],'#818578');polygon(ctx,[[-7,-14],[3,-19],[0,-6],[-10,-3]],'#a5ab96');
  }else if(kind==='animal'){
   ctx.fillStyle='#ded0b1';ctx.beginPath();ctx.ellipse(0,-8,7,4,0,0,Math.PI*2);ctx.fill();
   ctx.fillRect(-5,-7,2,7);ctx.fillRect(3,-7,2,7);polygon(ctx,[[4,-10],[6,-17],[9,-15],[10,-8]],'#ded0b1');
   line(ctx,[[-6,-9],[-10,-14]],dark,1.5);
  }else if(kind==='civilian'||kind==='soldier'){
   const color=kind==='civilian'?'#edc574':'#7c9c71';ctx.fillStyle=color;ctx.beginPath();ctx.arc(0,-18,3,0,7);ctx.fill();
   line(ctx,[[0,-12],[0,-6],[-4,0],[0,-6],[4,0]],dark,2.2);line(ctx,[[-5,-9],[0,-12],[5,-8]],color,3);
  }else if(kind==='aircraft'){
   polygon(ctx,[[0,-22],[3,-12],[12,-6],[3,-7],[4,1],[0,-2],[-4,1],[-3,-7],[-12,-6],[-3,-12]],'#c3c9bc');
  }else{
   polygon(ctx,[[-12,-8],[0,-14],[12,-8],[0,-2]],'#7f9479');line(ctx,[[-10,-3],[0,2],[10,-3]],dark,4);line(ctx,[[0,-10],[10,-16]],dark,2);
  }
  ctx.restore();
 }
 const api={path,polygon,line,symbol};root.CrateToySymbols=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
