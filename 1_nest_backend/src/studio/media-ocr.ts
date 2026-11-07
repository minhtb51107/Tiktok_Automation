import {execFile} from 'child_process';
import * as path from 'path';
import {createHash} from 'crypto';
import {promises as fs} from 'fs';
export interface MediaOcr {
 version:'media-ocr/1'; imageHash:string;sourceUrl:string;engine:string;language:string;confidence:number|null;
 rawText:string;blocks:Array<{order:number;text:string;words:unknown[]}>;
 correctedText:string;summaryText:string;mode:'READ_FULL'|'SUMMARIZE'|'SKIP';
 review:'NEEDS_REVIEW'|'REVIEWED';reviewer:'USER'|'AGENT_VISUAL'|null;
 warnings:string[];elapsedMs:number;createdAt:string;revision:number;
}
export async function localOcr(file:string,imageHash:string,sourceUrl:string):Promise<MediaOcr>{
 const bytes=await fs.readFile(file);if(bytes.length>3*1024**2||createHash('sha256').update(bytes).digest('hex')!==imageHash)throw Error('OCR_IMAGE_INTEGRITY');
 const started=Date.now();const result:any=await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-File',path.resolve('scripts/windows-ocr.ps1'),'-ImagePath',file],{windowsHide:true,timeout:30000,maxBuffer:2*1024**2},(e,out)=>{if(e)return reject(Error('LOCAL_OCR_FAILED'));try{resolve(JSON.parse(out.replace(/^\uFEFF/,'')))}catch{reject(Error('LOCAL_OCR_INVALID_OUTPUT'))}}));
 return {version:'media-ocr/1',imageHash,sourceUrl,engine:result.engine,language:result.language,confidence:null,rawText:result.text,blocks:result.blocks,correctedText:result.text,summaryText:'',mode:'SKIP',review:'NEEDS_REVIEW',reviewer:null,warnings:result.warnings,elapsedMs:Date.now()-started,createdAt:new Date().toISOString(),revision:0};
}
export function imageNarration(records:Record<string,MediaOcr>,order=Object.keys(records)){
 return order.map(key=>records[key]).filter(r=>r&&r.mode!=='SKIP').map(r=>{if(r.review!=='REVIEWED')throw Error('OCR_REVIEW_REQUIRED');const text=r.mode==='SUMMARIZE'?r.summaryText:r.correctedText;if(!text.trim())throw Error('OCR_NARRATION_EMPTY');return text;});
}
