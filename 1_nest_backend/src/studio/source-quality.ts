import type {PublicRecord} from './public-types';

/** Advisory projection only: never writes original text or user edits. */
export function cleanSourceProjection(raw: PublicRecord) {
  const removed: string[]=[];
  const timestamp=raw.fields?.createdAt?.raw;
  const lines=(raw.bodyText??raw.text).split('\n');
  const text=lines.filter((line,index)=>{
    const savedDomTime=index===0&&!!raw.createdAt&&/DOM time/i.test(raw.provenance?.createdAt||'')&&/^\d+\s*(giây|phút|giờ|ngày|tuần|tháng|năm)$/.test(line.trim());
    const time=(typeof timestamp==='string'&&line.trim()===timestamp.trim())||savedDomTime;
    const control=index===lines.length-1&&['Tiết lộ nội dung','Reveal content'].includes(line.trim());
    if(time||control){removed.push(line);return false;}return true;
  }).join('\n');
  return {text,removed,method:'SAVED_LABEL_PROJECTION_V1',warnings:removed.length?['Projection excludes observed timestamp/control labels; original preserved.']:[]};
}
export function analyzeSourceCards(cards: PublicRecord[],rootText:string) {
  const norm=(s:string)=>s.normalize('NFC').toLocaleLowerCase('vi').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
  const words=(s:string)=>new Set(norm(s).split(' ').filter(w=>w.length>2));
  const root=words(rootText),seen=new Map<string,number>(),previous:Array<Set<string>>=[];
  return cards.map((card,index)=>{
    const projection=cleanSourceProjection(card),key=norm(projection.text)||projection.text.trim(),tokens=words(projection.text),reasons:string[]=[];
    const duplicateOf=key&&seen.has(key)?seen.get(key)!:null;if(key&&!seen.has(key))seen.set(key,index);
    const overlap=[...tokens].filter(w=>root.has(w)).length;
    const nearDuplicateOf=tokens.size>=8?previous.findIndex(other=>{const common=[...tokens].filter(w=>other.has(w)).length;return common/(tokens.size+other.size-common)>=0.9;}):-1;
    previous.push(tokens);
    const argument=/(nhưng|vì|bởi|không đồng ý|theo tôi|mình|trải nghiệm|ví dụ|tại sao)/iu.test(projection.text);
    if(!key)reasons.push('MISSING_CONTENT');
    if(duplicateOf!==null)reasons.push('EXACT_DUPLICATE');
    if(nearDuplicateOf>=0&&duplicateOf===null)reasons.push('NEAR_DUPLICATE_LEXICAL_0_9');
    if(key.length<25&&!argument)reasons.push('SHORT_LOW_INFORMATION');
    if(!overlap)reasons.push('LEXICAL_RELEVANCE_UNCERTAIN');
    if(!card.url||!card.provenance?.text)reasons.push('MISSING_SOURCE_PROVENANCE');
    if(argument)reasons.push('DIALOGUE_ARGUMENT_OR_EXPERIENCE_MARKER');
    if(key.length>1200)reasons.push('LONG_CARD_REVIEW');
    const low=!key||duplicateOf!==null||nearDuplicateOf>=0||(key.length<25&&!argument);
    return {index,version:'source-quality/1',characters:projection.text.length,lexicalOverlap:overlap,duplicateOf,nearDuplicateOf:nearDuplicateOf<0?null:nearDuplicateOf,reasons,bucket:low?'LOW_VALUE':argument||overlap>=2?'RECOMMENDED':'NEEDS_REVIEW',projection,relationship:'OBSERVED_ON_TARGET_PAGE' as const,parentId:null};
  });
}
