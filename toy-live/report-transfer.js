/* Split the large cell DTO into short message tasks; numerical work is complete
 * before transfer. Legacy workers/callers still exchange one result message. */
(function(root){'use strict';
 function send(post,id,result){
  const cells=result.report.cells,sourceCells=result.source?.cells;
  const head={...result,id,reportHeader:true,cellCount:cells.length,sourceCellCount:sourceCells?.length||0,
   report:{...result.report,cells:[]}};
  if(sourceCells)head.source={...result.source,cells:[]};
  post(head,[result.search]);
  for(const [kind,rows]of [['reportCells',cells],['sourceCells',sourceCells]])if(rows)for(let offset=0;offset<rows.length;offset+=256)
   post({id,[kind]:rows.slice(offset,offset+256),offset});
  post({id,reportDone:true});
 }
 function receive(job,data){
  if(data.reportHeader){job.reportTransfer=data;return null;}
  for(const [field,target,maximum]of [['reportCells','report','cellCount'],['sourceCells','source','sourceCellCount']])if(data[field]){
   const head=job.reportTransfer,rows=head?.[target]?.cells;
   if(!rows||data.offset!==rows.length||rows.length+data[field].length>head[maximum])throw Error('Invalid report cell transfer');
   for(const row of data[field])rows.push(row);return null;
  }
  if(data.reportDone){
   const result=job.reportTransfer;delete job.reportTransfer;
   if(!result||result.report.cells.length!==result.cellCount||(result.source?.cells?.length||0)!==result.sourceCellCount)throw Error('Incomplete report cell transfer');
   delete result.reportHeader;delete result.cellCount;delete result.sourceCellCount;return result;
  }
  return data;
 }
 async function postSource(post,message,{valid=()=>true,now=()=>performance.now(),yieldToUI=()=>root.scheduler?.yield?root.scheduler.yield():new Promise(r=>setTimeout(r,0)),transfer=[]}={}){
  if(!valid())return;
  const cells=message.source?.cells;
  if(!cells||cells.length<1024){if(valid())post(message,transfer);return;}
  post({id:message.id,sourceHeader:{...message,source:{...message.source,cells:[]}},sourceCount:cells.length},transfer);
  let at=now();
  for(let offset=0;offset<cells.length;offset+=256){
   if(!valid())return;post({id:message.id,sourceRows:cells.slice(offset,offset+256),offset});
   if(now()-at>=3){await yieldToUI();at=now();}
  }
  if(valid())post({id:message.id,sourceDone:true});
 }
 function receiveSource(job,data){
  if(data.sourceHeader){job.sourceTransfer=data;return null;}
  if(data.sourceRows){
   const head=job.sourceTransfer,rows=head?.sourceHeader.source.cells;
   if(!rows||head.id!==data.id||rows.length!==data.offset||rows.length+data.sourceRows.length>head.sourceCount)throw Error('Invalid source cell transfer');
   for(const row of data.sourceRows)rows.push(row);return null;
  }
  if(data.sourceDone){
   const head=job.sourceTransfer;delete job.sourceTransfer;
   if(!head||head.id!==data.id||head.sourceHeader.source.cells.length!==head.sourceCount)throw Error('Incomplete source cell transfer');
   return head.sourceHeader;
  }
  return data;
 }
 root.CrateLiveReportTransfer={send,receive,postSource,receiveSource};
 if(typeof module!=='undefined')module.exports=root.CrateLiveReportTransfer;
})(globalThis);
