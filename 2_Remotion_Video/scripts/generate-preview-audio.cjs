// SYNTHETIC TEST TONES ONLY. Recreates ignored offline preview media; no speech/TTS.
const fs=require('fs'),p=require('path');
const dir=p.resolve(__dirname,'../public/fixtures/video-pipeline/audio');fs.mkdirSync(dir,{recursive:true});
const fixtures=[['funny-post',2200],['funny-comment-1',1800],['funny-comment-2',2500],['funny-comment-3',1600],['serious-post',4200],['serious-comment',3600],['pop',250]];
for(const [index,[name,ms]]of fixtures.entries()){
 const file=p.join(dir,name+'.wav');if(fs.existsSync(file))continue;
 const rate=24000,samples=Math.round(ms*rate/1000),b=Buffer.alloc(44+samples*2);
 b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++){const fade=Math.min(1,i/(rate*.02),(samples-1-i)/(rate*.02));b.writeInt16LE(Math.round(3000*fade*Math.sin(2*Math.PI*(220+index*45)*i/rate)),44+i*2)}
 fs.writeFileSync(file,b,{flag:'wx'});
}
console.log('Offline preview tones available (SYNTHETIC, ignored by Git).');
