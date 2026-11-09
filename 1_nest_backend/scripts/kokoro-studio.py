"""Local-only Kokoro bridge. Preflight never loads a model; worker forbids network."""
import sys, os, json, ast, pathlib, importlib.util, importlib.metadata, threading, time, contextlib, re
from kokoro_memory import memory_sample, allocation_failure
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
import socket
def no_network(*args,**kwargs): raise RuntimeError('NETWORK_DISABLED')
socket.socket.connect=no_network
socket.create_connection=no_network
socket.getaddrinfo=no_network

def config():
    return json.loads(os.environ.get('STUDIO_TTS_CONFIG', '{}'))

def preflight(cfg,verify_imports=True):
    modules={name:importlib.util.find_spec(name) is not None for name in ['soundfile','kokoro_vietnamese','numpy','torch','vig2p']}
    spec=importlib.util.find_spec('kokoro_vietnamese')
    core=(pathlib.Path(spec.origin).parent/'core.py') if spec and spec.origin else pathlib.Path(cfg.get('source',''))/'src/kokoro_vietnamese/core.py'
    voices={}
    if core.is_file():
        tree=ast.parse(core.read_text(encoding='utf-8'))
        for node in tree.body:
            if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='VOICES' for t in node.targets):
                voices=ast.literal_eval(node.value)
    declared=[{'id':k,'label':v['label']} for k,v in voices.items()]
    model=pathlib.Path(cfg.get('model','__missing__')); conf=pathlib.Path(cfg.get('config','__missing__')); voice_dir=pathlib.Path(cfg.get('voiceDir','__missing__'))
    blockers=['Missing import: '+k for k,v in modules.items() if not v]
    if not model.is_file(): blockers.append('Local Kokoro model not configured or missing')
    if not conf.is_file(): blockers.append('Local Kokoro config.json not configured or missing')
    available=[v for v in declared if (voice_dir/(v['id']+'.pt')).is_file()]
    if not available: blockers.append('No local voicepack available')
    gpu=None
    if not blockers and verify_imports:
        try:
            import soundfile, numpy, kokoro_vietnamese, torch, vig2p
            gpu=torch.cuda.is_available()
        except Exception as e: blockers.append('Runtime import check failed: '+type(e).__name__)
    warnings=[] if verify_imports else ['IMPORTS_UNVERIFIED: static inspection only; no Torch/model loaded']
    version=None
    if modules['kokoro_vietnamese']:
        try: version=importlib.metadata.version('kokoro-vietnamese')
        except importlib.metadata.PackageNotFoundError: version='unversioned'
    fingerprint='missing'
    if model.is_file():
        parts=[]
        for file in [model,conf]+[voice_dir/(v['id']+'.pt') for v in available]:
            if file.is_file():
                stat=file.stat();parts.append(file.name+':'+str(stat.st_size)+':'+str(stat.st_mtime_ns))
        fingerprint='|'.join(parts)
    return {'python':sys.version.split()[0],'packageVersion':version,'imports':modules,'importsVerified':verify_imports and not blockers,'warnings':warnings,'declaredVoices':declared,'voices':available,'model':model.name if model.is_file() else None,'modelVersion':fingerprint,'device':cfg.get('device','cpu'),'gpuAvailable':gpu,'blockers':blockers}

if '--preflight' in sys.argv or '--inspect' in sys.argv:
    try: print(json.dumps(preflight(config(),'--inspect' not in sys.argv),ensure_ascii=False))
    except Exception as e: print(json.dumps({'blockers':['Preflight failed: '+type(e).__name__]}))
    sys.exit(0)

# Never download missing weights, tokenizer or G2P models, even transitively.
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
import socket
def no_network(*args,**kwargs): raise RuntimeError('NETWORK_DISABLED')
socket.socket.connect=no_network
parent=os.getppid()
def watch_parent():
    while True:
        time.sleep(2)
        if os.name=='nt':
            import ctypes
            handle=ctypes.windll.kernel32.OpenProcess(0x00100000,False,parent)
            if not handle: os._exit(0)
            state=ctypes.windll.kernel32.WaitForSingleObject(handle,0)
            ctypes.windll.kernel32.CloseHandle(handle)
            if state==0: os._exit(0)
        elif os.getppid()!=parent: os._exit(0)
threading.Thread(target=watch_parent,daemon=True).start()
tts=None; current=None; current_voice=None; active=False; measurements=[]
protocol_lock=threading.Lock()
def emit(value):
    with protocol_lock:
        sys.__stdout__.write('@STUDIO@'+json.dumps(value)+'\n');sys.__stdout__.flush()

def observe_memory():
    while True:
        time.sleep(0.25)
        if not active: continue
        try:
            sample=memory_sample()
            if sample:
                measurements.append(sample)
                # Retain the complete 300-second approved batch (4 samples/s), bounded.
                if len(measurements)>2048: del measurements[0]
                emit({'resource':sample})
                if sample['availableMiB']<256 or sample['systemCommitAvailableMiB']<512:
                    emit({'ok':False,'category':'RESOURCE_GUARD_STOP','error':'RESOURCE_GUARD_STOP: physical RAM or commit reserve below emergency floor'})
                    os._exit(70)
        except Exception:
            emit({'ok':False,'category':'RESOURCE_GUARD_STOP','error':'RESOURCE_GUARD_STOP: native memory monitor failed'})
            os._exit(71)
threading.Thread(target=observe_memory,daemon=True).start()
def stage(name):
    emit({'stage':name,'resource':memory_sample()})
for line in sys.stdin:
    try:
        req=json.loads(line);cfg=config();key=(cfg['model'],cfg['config'],cfg.get('device','cpu'));active=True;measurements=[];started=time.monotonic();before=None;after=None;runtime_before=None;runtime_after=None
        with contextlib.redirect_stdout(sys.stderr):
            if current!=key:
                stage('Importing runtime');runtime_before=memory_sample()
                import torch, soundfile
                tts=None
                from kokoro_vietnamese import KokoroVietnamese
                runtime_after=memory_sample();stage('Loading model');before=memory_sample()
                tts=KokoroVietnamese(model_path=cfg['model'],config_path=cfg['config'],voicepack_path=str(pathlib.Path(cfg['voiceDir'])/(req['voice']+'.pt')),voice=req['voice'],device=cfg.get('device','cpu'))
                current=key
                current_voice=req['voice']
                after=memory_sample()
                stage('Model loaded')
            elif current_voice != req['voice']:
                # The installed Kokoro implementation uses voicepack[len(phonemes)-1].
                # Swap only the small tensor, retaining the single shared model.
                import torch
                pack=pathlib.Path(cfg['voiceDir'])/(req['voice']+'.pt')
                tts.voicepack=torch.load(pack,map_location='cpu',weights_only=True)
                tts.voicepack_path=pack
                current_voice=req['voice']
            import soundfile as sf
            stage('Synthesizing')
            inference_before=memory_sample()
            if re.search(r'\d',req['text']): raise RuntimeError('UNNORMALIZED_NUMERIC_INPUT')
            audio,phonemes=tts.synthesize(req['text'],speed=1.0)
            inference_after=memory_sample()
            if len(audio)==0: raise RuntimeError('EMPTY_AUDIO')
            sf.write(req['output'],audio,24000)
        from kokoro_vietnamese.core import split_text
        chunks=split_text(req['text'])
        final=memory_sample()
        if final: measurements.append(final)
        active=False
        metrics={'inputCharacters':len(req['text']),'sentenceChunks':len(chunks),'maxSentenceCharacters':max(map(len,chunks),default=0),'elapsedMs':round((time.monotonic()-started)*1000),'peakRssMiB':max((m['peakRssMiB'] for m in measurements),default=None),'peakPrivateMiB':max((m['privateMiB'] for m in measurements),default=None),'minimumAvailableMiB':min((m['availableMiB'] for m in measurements),default=None),'modelBefore':before,'modelAfter':after}
        metrics.update({'runtimeBefore':runtime_before,'runtimeAfter':runtime_after,'inferenceBefore':inference_before,'inferenceAfter':inference_after})
        emit({'ok':True,'metrics':metrics})
    except Exception as e:
        active=False
        allocation=allocation_failure(e)
        emit({'ok':False,'category':'ALLOCATION_FAILURE' if allocation else 'UNKNOWN','error':('ALLOCATION_FAILURE' if allocation else 'UNKNOWN')+': Kokoro '+type(e).__name__,'details':{'errorType':type(e).__name__,'winerror':getattr(e,'winerror',None),'errno':getattr(e,'errno',None),'allocatorFailure':allocation}})
