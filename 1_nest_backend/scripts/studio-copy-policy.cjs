// Fail-closed policy for the isolated REAL_DATA_COPY server. Never a production authorization layer.
function allowed(method,path,body={}){
 if(/\/oauth\//.test(path))return false;
 if(['GET','HEAD'].includes(method))return true;
 if(method==='POST'&&path==='/api/studio/sessions')return true;
 if(method==='PUT'&&/^\/api\/studio\/sessions\/[a-f0-9-]{36}(?:\/editor)?$/.test(path))return true;
 if(method==='POST'&&/^\/api\/studio\/sessions\/[a-f0-9-]{36}\/jobs$/.test(path))return body.operation==='editor/prepare'||body.operation==='script/propose-offline-all'||(/^script\/[^/]+\/propose$/.test(body.operation)&&body.input?.mode==='OFFLINE');
 if(method==='POST'&&/^\/api\/studio\/sessions\/[a-f0-9-]{36}\/script\/decision$/.test(path))return ['ACCEPT','REJECT','ACCEPT_LOCKED'].includes(body.action);
 if(method==='POST'&&/^\/api\/studio\/sessions\/[a-f0-9-]{36}\/editor\/prepare$/.test(path))return true;
 // No review, queue, approval, inference, deletion, upload, external metadata, credentials or source mutation.
 return false;
}
module.exports={allowed};
