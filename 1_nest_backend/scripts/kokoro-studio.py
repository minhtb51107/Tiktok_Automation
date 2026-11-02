"""Local-only Kokoro bridge. Preflight never loads a model; worker forbids network."""
import sys, os, json, ast, pathlib, importlib.util, importlib.metadata, threading, time, contextlib
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
import socket
def no_network(*args,**kwargs): raise RuntimeError('NETWORK_DISABLED')
socket.socket.connect=no_network
socket.create_connection=no_network
socket.getaddrinfo=no_network

def config():
    return json.loads(os.environ.get('STUDIO_TTS_CONFIG', '{}'))

def preflight(cfg):
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
    if not blockers:
        try:
            import soundfile, numpy, kokoro_vietnamese, torch, vig2p
            gpu=torch.cuda.is_available()
        except Exception as e: blockers.append('Runtime import check failed: '+type(e).__name__)
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
    return {'python':sys.version.split()[0],'packageVersion':version,'imports':modules,'declaredVoices':declared,'voices':available if not blockers else [],'model':model.name if model.is_file() else None,'modelVersion':fingerprint,'device':cfg.get('device','cpu'),'gpuAvailable':gpu,'blockers':blockers}

if '--preflight' in sys.argv:
    try: print(json.dumps(preflight(config()),ensure_ascii=False))
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
tts=None; current=None; current_voice=None
def stage(name):
    sys.__stdout__.write('@STUDIO@'+json.dumps({'stage':name})+'\n');sys.__stdout__.flush()
for line in sys.stdin:
    try:
        req=json.loads(line);cfg=config();key=(cfg['model'],cfg['config'],cfg.get('device','cpu'))
        with contextlib.redirect_stdout(sys.stderr):
            if current!=key:
                stage('Loading model')
                tts=None
                from kokoro_vietnamese import KokoroVietnamese
                tts=KokoroVietnamese(model_path=cfg['model'],config_path=cfg['config'],voicepack_path=str(pathlib.Path(cfg['voiceDir'])/(req['voice']+'.pt')),voice=req['voice'],device=cfg.get('device','cpu'))
                current=key
                current_voice=req['voice']
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
            audio,_=tts.synthesize(req['text'],speed=1.0)
            if len(audio)==0: raise RuntimeError('EMPTY_AUDIO')
            sf.write(req['output'],audio,24000)
        print('@STUDIO@'+json.dumps({'ok':True}),flush=True)
    except Exception as e:
        print('@STUDIO@'+json.dumps({'ok':False,'error':'Kokoro inference failed: '+type(e).__name__}),flush=True)
