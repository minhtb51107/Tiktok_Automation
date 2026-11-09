import {useState} from 'react';
import type {StudioItem,StudioSession} from '../../../1_nest_backend/src/studio/studio.contracts';
import {studioRequest} from './integration-api';
export function MediaOcrPanel({session,item,onSession,disabled}:{session:StudioSession;item:StudioItem;onSession:(s:StudioSession)=>void;disabled:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function action(sha:string,body:Record<string,unknown>){setBusy(true);setError('');try{onSession(await studioRequest<StudioSession>(`/sessions/${session.id}/media-ocr/${item.id}/${sha}`,{revision:session.revision,...body}));}catch(e){setError(String(e));}finally{setBusy(false)}}
 return <details><summary>Ảnh → OCR → giọng đọc (local, cần kiểm tra)</summary><p>Không đổi bản gốc. Lưu Script trước khi chạy OCR. Windows OCR hiện không có tiếng Việt; kiểm tra dấu và nội dung trước khi dùng. Không tự phê duyệt xuất bản.</p>{item.localSourceMedia?.filter(a=>a.status==='DOWNLOADED'&&a.sha256).map(a=>{const sha=a.sha256!;const o=item.mediaOcr?.[sha];return <section key={sha}>
  <img alt="Ảnh nguồn OCR" src={a.localUri!} style={{maxWidth:'100%',maxHeight:240,objectFit:'contain'}}/>
  {!o?<button disabled={disabled||busy} onClick={()=>void action(sha,{action:'OCR'})}>OCR ảnh cục bộ</button>:<div key={o.revision}>
   <p>{o.engine} · {o.language} · confidence: {o.confidence??'không cung cấp'} · {o.review} · {o.reviewer??'chưa review'}</p><p>{o.warnings.join('; ')}</p>
   <p>{item.mediaNarrationApplied?.some(a=>a.imageHash===sha&&a.ocrRevision===o.revision)?'Phiên bản này đã được ghép vào spoken text.':'Phiên bản OCR này chưa được ghép vào spoken text.'}</p>
   <details><summary>OCR gốc / thứ tự khối</summary><pre style={{whiteSpace:'pre-wrap'}}>{o.blocks.map(b=>`${b.order+1}. ${b.text}`).join('\n')}</pre></details>
   <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void action(sha,{action:'SAVE',ocrRevision:o.revision,text:f.get('text'),summary:f.get('summary'),mode:f.get('mode'),confirmReview:true,reviewer:'USER'})}}>
    <label>Văn bản ảnh đã kiểm tra<textarea name="text" aria-label="OCR corrected text" defaultValue={o.correctedText} rows={7}/></label>
    <label>Chế độ<select name="mode" defaultValue={o.review==='NEEDS_REVIEW'?'READ_FULL':o.mode}><option>READ_FULL</option><option>SUMMARIZE</option><option>SKIP</option></select></label>
    <label>Tóm tắt do người dùng viết (chỉ SUMMARIZE)<textarea name="summary" defaultValue={o.summaryText}/></label>
    <button disabled={disabled||busy}>Tôi đã kiểm tra: lưu OCR / chế độ</button>
   </form>
   <button disabled={disabled||busy||o.review!=='REVIEWED'||item.manualLocks.includes('NARRATION_TEXT')} onClick={()=>void action(sha,{action:'APPLY',ocrRevision:o.revision})}>Đưa nội dung ảnh sau lời đọc bài này</button>
   {item.manualLocks.includes('NARRATION_TEXT')&&<p>Spoken text đang khóa: mở khóa trong Script trước khi ghép nội dung ảnh.</p>}
  </div>}
 </section>})}{!item.localSourceMedia?.some(a=>a.status==='DOWNLOADED')&&<p>Chưa có ảnh local đã xác minh cho mục này. Không tự tải URL remote.</p>}{busy&&<p role="status">Đang xử lý OCR local…</p>}{error&&<p role="alert">{error}</p>}</details>;
}
