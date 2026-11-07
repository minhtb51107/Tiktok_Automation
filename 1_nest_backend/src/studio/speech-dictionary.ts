/** Independently authored mappings; no external corpus/model copied. */
export const SPEECH_DICTIONARY_VERSION='vi-social-speech/1';
export const SPEECH_DICTIONARY=Object.freeze([
 {term:'cmt',spoken:'bình luận',category:'ABBREVIATION'},
 {term:'ko',spoken:'không',category:'TEENCODE'},
 {term:'cty',spoken:'công ty',category:'ABBREVIATION'},
 {term:'nma',spoken:'nhưng mà',category:'TEENCODE'},
 {term:'mn',spoken:'mọi người',category:'TEENCODE'},
 {term:'tphcm',spoken:'Thành phố Hồ Chí Minh',category:'PLACE'},
 {term:'NEU',spoken:'en e u',category:'ACRONYM',caseSensitive:true},
 {term:'FTU',spoken:'ép tê u',category:'ACRONYM',caseSensitive:true},
]);
export function validatePronunciations(x:unknown):Record<string,string>{
 if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).length>50)throw Error('Invalid pronunciation overrides');
 for(const [key,value]of Object.entries(x))if(!key.trim()||key.length>80||['__proto__','constructor','prototype'].includes(key)||typeof value!=='string'||!value.trim()||value.length>200)throw Error('Invalid pronunciation override');
 return {...x} as Record<string,string>;
}
const cache=new Map<string,{text:string;ambiguous:string[];version:string}>();
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function speechProjection(text:string,overrides:Record<string,string>={}){
 validatePronunciations(overrides);const key=JSON.stringify([SPEECH_DICTIONARY_VERSION,text,overrides]);if(cache.has(key))return {...cache.get(key)!,cacheHit:true};
 let out=text;const explicit=new Set(Object.keys(overrides).map(k=>k.toLowerCase()));
 for(const [term,replacement]of Object.entries(overrides))out=out.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escape(term)}(?![\\p{L}\\p{N}_])`,'gu'),()=>replacement);
 for(const row of SPEECH_DICTIONARY){if(explicit.has(row.term.toLowerCase()))continue;out=out.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escape(row.term)}(?![\\p{L}\\p{N}_])`,row.caseSensitive?'gu':'giu'),row.spoken);}
 const ambiguous=[...new Set(Array.from(out.matchAll(/(?<![\p{L}\p{N}_])(t|đcđ|clm|cmn|neu|đc|k)(?![\p{L}\p{N}_])/giu),m=>m[0]))];
 const result={text:out,ambiguous,version:SPEECH_DICTIONARY_VERSION};if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(key,result);return {...result,cacheHit:false};
}
