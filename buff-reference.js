/* One reference for hypothetical cells, placed units, statistics and exports.
 * In an open field, occupying the center redistributes its original 1× mass
 * to the first ring. Every radius >= 2 contains that ring, so the reference
 * is the full square's area, rather than area - 1. Radius 1 yields zero for
 * an occupied center; use denominator 1 to avoid a meaningless 0/0. */
(function(root){
 'use strict';
 const radius=value=>Math.min(32,Math.max(1,Math.trunc(Number(value)||3)));
 const baseline=value=>(2*radius(value)-1)**2;
 const isBaseline=value=>Math.abs(value-1)<1e-10;
 function color(value,palette='warm',maximum=1,configuration){const colors=root.CrateProbability||(typeof require==='function'?require('./probability.js'):null);return colors.color(value,palette,Math.max(1,maximum),configuration);}
 function textColor(value,palette='warm',maximum=1,enabled=true,configuration){const colors=root.CrateProbability||(typeof require==='function'?require('./probability.js'):null);return colors.labelColor(value,palette,Math.max(1,maximum),enabled,configuration);}
 function paletteSettings(){const colors=root.CrateProbability||(typeof require==='function'?require('./probability.js'):null);return colors.paletteSettings();}
 function labelSize(scale,base,configuration){const colors=root.CrateProbability||(typeof require==='function'?require('./probability.js'):null);return colors.labelSize(scale,base,configuration);}
 function labelStrokeWidth(size,configuration){const colors=root.CrateProbability||(typeof require==='function'?require('./probability.js'):null);return colors.labelStrokeWidth(size,configuration);}
 const api={radius,baseline,isBaseline,color,textColor,paletteSettings,labelSize,labelStrokeWidth};root.CrateBuffReference=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
