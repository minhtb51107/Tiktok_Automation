export class StudioApiError extends Error { constructor(message:string,readonly status:number){super(message);} }
export async function studioRequest<T>(url:string,body?:unknown):Promise<T> {
 const r=await fetch('/api/studio'+url,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const j=await r.json();if(!r.ok){const message=j.error?.message||j.message||'Studio operation failed';throw new StudioApiError(Array.isArray(message)?message.join('; '):String(message),r.status);}
 return j.data??j;
}
export function discoveryIntent(input:{topic:string;limit:number;keyword?:string},saved:any,id:()=>string=()=>crypto.randomUUID()) {
 const key=JSON.stringify(input);
 return saved?.key===key&&saved?.body?.requestId?saved:{key,body:{mode:'SEARCH',...input,requestId:id()}};
}
export function exportJson(name:string,value:unknown){const u=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
