/* Same fixed, adjacency-constrained display lattice as the full painter.
 * Does not modify a cell's gameplay file, subtile or probability. */
(function(root){
 'use strict';
 const small=[0,1,2,3,3,2,1,0,2,3,0,1,1,0,3,2];
 const large=[4,0,1,3,1,0,3,7,2,5,7,4,5,4,5,6,7,3,1,2,6,7,2,4,6,5,0,7,5,3,6,5,1,2,6,2,1,7,2,0,3,7,4,3,0,4,3,7,5,0,2,6,1,2,1,0,1,3,4,0,5,6,4,6];
 function file(c,definitions){
  const entry=definitions?.[c.file];if(!entry||c.terrainError)return c.file;
  const [w,h,names]=entry,x=Math.trunc((c.x-c.subTile%w)/w),y=Math.trunc((c.y-Math.floor(c.subTile/w))/h);
  const i=names.length>4?large[(x&7)+(y&7)*8]:small[(x&3)+(y&3)*4];return names[i%names.length];
 }
 root.CrateTerrainVariants={file};
})(globalThis);
