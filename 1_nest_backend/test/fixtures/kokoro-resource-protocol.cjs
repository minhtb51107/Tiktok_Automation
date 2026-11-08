// SYNTHETIC protocol test only: no speech, Python, model or network.
process.stdin.once('data',()=>{
 const emit=x=>process.stdout.write('@STUDIO@'+JSON.stringify(x)+'\n');
 emit({stage:'TEST_STAGE',resource:{pid:process.pid,rssMiB:20,privateMiB:15,availableMiB:2048}});
 if(process.argv[2]==='hang')return setTimeout(()=>emit({ok:true}),5000);
 emit({ok:true,metrics:{inputCharacters:4,sentenceChunks:1,maxSentenceCharacters:4,elapsedMs:1,peakRssMiB:20,peakPrivateMiB:15,minimumAvailableMiB:2048}});
});
