// SYNTHETIC protocol test only: no speech, Python, model or network.
process.stdin.once('data',()=>{
 const emit=x=>process.stdout.write('@STUDIO@'+JSON.stringify(x)+'\n');
 if(process.argv[2]==='allocation')return emit({ok:false,category:'ALLOCATION_FAILURE',error:'ALLOCATION_FAILURE: MemoryError',details:{errorType:'MemoryError'}});
 if(process.argv[2]==='exit')return process.exit(1);
 if(process.argv[2]==='commit')return emit({resource:{pid:process.pid,rssMiB:20,availableMiB:512,systemCommitAvailableMiB:100}});
 emit({stage:'TEST_STAGE',resource:{pid:process.pid,rssMiB:20,privateMiB:15,availableMiB:2048}});
 if(process.argv[2]==='hang')return setTimeout(()=>emit({ok:true}),5000);
 emit({ok:true,metrics:{inputCharacters:4,sentenceChunks:1,maxSentenceCharacters:4,elapsedMs:1,peakRssMiB:20,peakPrivateMiB:15,minimumAvailableMiB:2048}});
});
