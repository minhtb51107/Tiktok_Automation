import type {PublicRecord} from './public-types';

/** Advisory projection only: never writes original text or user edits. */
export function cleanSourceProjection(raw: PublicRecord) {
  const removed:string[]=[],timestamp=raw.fields?.createdAt?.raw;
  const lines=(raw.bodyText??raw.text).split('\n');let header=true,removedTime=false;
  const domTime=!!raw.createdAt&&Number.isFinite(Date.parse(raw.createdAt))&&/DOM time/i.test(raw.provenance?.createdAt||'');
  const dates=domTime?[new Date(raw.createdAt!).toISOString().slice(0,10),new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(raw.createdAt!))]:[];
  const authoredLines=new Set(raw.text.split('\n').map(x=>x.trim()));
  const text=lines.filter((line,index)=>{
    const value=line.trim(),m=value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const dateKey=m?m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'):null;
    const knownTime=header&&((typeof timestamp==='string'&&value===timestamp.trim()&&(raw.bodyText===undefined||!authoredLines.has(value)))||(domTime&&(/^\d+\s*(giây|phút|giờ|ngày|tuần|tháng|năm)$/.test(value)||(!!dateKey&&dates.includes(dateKey)&&!authoredLines.has(value)))));
    const chrome=header&&removedTime&&!authoredLines.has(value)&&['·','•','Tác giả','Author','Đã ghim','Pinned',raw.handle,raw.author].filter(Boolean).includes(value);
    const control=index===lines.length-1&&['Tiết lộ nội dung','Reveal content'].includes(value)&&!authoredLines.has(value);
    if(knownTime||chrome||control){removed.push(line);if(knownTime)removedTime=true;return false;}
    if(value)header=false;return true;
  }).join('\n');
  return {text,removed,method:'SAVED_LABEL_PROJECTION_V2',warnings:removed.length?['Projection excludes evidenced header chrome; original and saved edits preserved.']:[]};
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

export const SOURCE_QUALITY_V2={version:'source-quality/2',SERIOUS:{relevance:25,structure:30,context:25,engagement:10,media:10},FUNNY:{relevance:30,structure:20,context:20,engagement:15,media:15}};
/** Lexical advisory, never a semantic verdict or approval. OCR must be reviewed. */
export function analyzeSourceCardsV2(cards:PublicRecord[],rootText:string,style:'SERIOUS'|'FUNNY'='SERIOUS',images:Record<number,{text:string;reviewed:boolean}>={},rootIndex=-1){
 const v1=analyzeSourceCards(cards,rootText),cfg=SOURCE_QUALITY_V2[style];
 const expanded=analyzeSourceCards(cards.map((card,n)=>{const text=cleanSourceProjection(card).text+(images[n]?.reviewed?'\n'+images[n].text:'');return {...card,text,bodyText:text}}),rootText);
 return v1.map((old,index)=>{
  const card=cards[index],image=images[index],text=old.projection.text+(image?.reviewed?'\n'+image.text:''),words=text.trim().split(/\s+/u).filter(Boolean),reasons=old.reasons.filter(r=>!['SHORT_LOW_INFORMATION','DIALOGUE_ARGUMENT_OR_EXPERIENCE_MARKER','EXACT_DUPLICATE','NEAR_DUPLICATE_LEXICAL_0_9','MISSING_CONTENT'].includes(r));
  const lexical=analyzeSourceCards([{...card,text,bodyText:text}],rootText)[0];
  const clauses=text.split(/[.!?;\n]/).filter(x=>x.trim().split(/\s+/).length>=4).length;
  const argument=clauses>=2&&/(vì|nhưng|bởi|nên|tuy nhiên|ví dụ)/iu.test(text)&&words.length>=18;
  const observed=card.fields?.likeCount,likes=observed?.status==='AVAILABLE'&&typeof observed.value==='number'&&observed.value>=0?observed.value:null;
  const breakdown={relevance:Math.min(1,lexical.lexicalOverlap/4)*cfg.relevance,structure:argument?cfg.structure:0,context:Math.min(1,words.length/60)*cfg.context,engagement:likes===null?0:Math.min(1,Math.log10(1+likes)/4)*cfg.engagement,media:image?.reviewed&&image.text.trim()?cfg.media:0};
  const isRoot=index===rootIndex,hasImage=card.media?.some(m=>m.kind!=='VIDEO'),duplicate=(!hasImage||image?.reviewed)&&(expanded[index].duplicateOf!==null||expanded[index].nearDuplicateOf!==null),low=!isRoot&&!hasImage&&words.length<5&&!argument;
  reasons.push('LEXICAL_RULES_NOT_SEMANTIC_PROOF',likes===null?'ENGAGEMENT_UNAVAILABLE':`DIRECT_LABEL_LIKES${observed?.approximate?'_APPROXIMATE':''}`,argument?'MULTI_CLAUSE_REASONING_SIGNAL':'ARGUMENT_UNCERTAIN');
  if(hasImage&&!image?.reviewed)reasons.push('IMAGE_CONTENT_NEEDS_REVIEW');if(low)reasons.push('SHORT_LOW_INFORMATION');if(isRoot)reasons.push('ROOT_SHORT_OR_QUESTION_ALLOWED');
  if(duplicate)reasons.push('DUPLICATE_COMBINED_TEXT');if(!text.trim())reasons.push(hasImage?'MISSING_IMAGE_TRANSCRIPTION':'MISSING_CONTENT');
  const score=duplicate?0:Math.round(Object.values(breakdown).reduce((a,b)=>a+b,0));
  return {...old,version:SOURCE_QUALITY_V2.version,v1:old,style,score,breakdown,lexicalOverlap:lexical.lexicalOverlap,duplicateOf:duplicate?expanded[index].duplicateOf:null,nearDuplicateOf:duplicate?expanded[index].nearDuplicateOf:null,reviewedOcrCharacters:image?.reviewed?image.text.length:0,engagement:{likes,approximate:observed?.approximate??null},reasons,bucket:duplicate||low?'LOW_VALUE':isRoot||argument&&lexical.lexicalOverlap>0?'RECOMMENDED':'NEEDS_REVIEW',accuracy:'NOT_MEASURED'};
 });
}
