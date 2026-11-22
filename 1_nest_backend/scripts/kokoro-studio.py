"""Local-only Kokoro bridge. Preflight never loads a model; worker forbids network."""
import sys, os, json, ast, pathlib, importlib.util, importlib.metadata, threading, time, contextlib, re, tempfile, subprocess, gc
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

@contextlib.contextmanager
def low_memory_torch_loading(torch):
    """Map local weights and assign tensors instead of keeping a second full copy."""
    original_load=torch.load
    original_load_state_dict=torch.nn.Module.load_state_dict
    def mapped_load(file,*args,**kwargs):
        if isinstance(file,(str,os.PathLike)):
            kwargs.setdefault('mmap',True)
        return original_load(file,*args,**kwargs)
    def assigned_state_dict(module,state_dict,strict=True,assign=False):
        return original_load_state_dict(module,state_dict,strict=strict,assign=True)
    torch.load=mapped_load
    torch.nn.Module.load_state_dict=assigned_state_dict
    try:
        yield
    finally:
        torch.load=original_load
        torch.nn.Module.load_state_dict=original_load_state_dict

NUMBER_WORDS=set(['không','một','hai','ba','bốn','năm','sáu','bảy','tám','chín','mười','mươi','mốt','tư','lăm','linh','lẻ','trăm','nghìn','ngàn','triệu','tỷ','phẩy','chấm','cộng','trừ'])

def prepare_tts_transport_text(text):
    """Prepare TTS transport string without altering user originalText/displayText/spokenText."""
    s=str(text or '').replace('\r\n','\n').replace('\r','\n')
    # Replace ': …' or ': ...' placeholder patterns that cause Kokoro OOV/hallucination.
    s=re.sub(r':\s*(?:\.\.\.|…)+','.',s)
    # Preserve line breaks as sentence boundaries when lines lack terminal punctuation.
    lines=[]
    for raw_line in s.split('\n'):
        line=re.sub(r'^\s*(?:[•·\-–—]+)\s*','',raw_line.strip())
        if not line:
            continue
        if not re.search(r'[.!?…,:;]$',line):
            line=line+'.'
        lines.append(line)
    s=' '.join(lines)
    # Mid-sentence ellipsis before lowercase continuation -> comma pause; other ellipsis -> period.
    s=re.sub(r'(?:\.\.\.|…)+\s*(?=[a-zà-ỹ])',', ',s)
    s=re.sub(r'(?:\.\.\.|…)+','.',s)
    # Convert parenthetical and quoted spans to comma-delimited clauses so '(' / ')' / '"'
    # vocab tokens never glue to Vietnamese tone arrows (↗/↘).
    for _ in range(2):
        s=re.sub(r'\(\s*([^()]+?)\s*\)',r', \1, ',s)
    s=re.sub(r'["“”]\s*([^"“”]+?)\s*["“”]',r', \1, ',s)
    s=re.sub(r'["“”()]',' ',s)
    # Split hyphenated Vietnamese syllables (e.g. vô-trùng -> vô trùng) so vig2p fix_phonemes
    # applies onset corrections (tr, s, th, gi) to every syllable.
    s=re.sub(r'(?<=[A-Za-zÀ-ỹ])-(?=[A-Za-zÀ-ỹ])',' ',s)
    # Clean up redundant punctuation spacing.
    s=re.sub(r'\s+([,.;:!?])',r'\1',s)
    s=re.sub(r'([,;:!?])\s*([,.;:!?])+',r'\1',s)
    s=re.sub(r'\.\s*\.+','.',s)
    s=re.sub(r',\s*([.!?])',r'\1',s)
    s=re.sub(r'([.!?])\s*,',r'\1',s)
    s=re.sub(r'\s+',' ',s).strip()
    return s

def _is_number_split(value, cut_pos):
    left=re.findall(r'[A-Za-zÀ-ỹ]+',value[:cut_pos].lower())
    right=re.findall(r'[A-Za-zÀ-ỹ]+',value[cut_pos:].lower())
    if not left or not right:
        return False
    return left[-1] in NUMBER_WORDS and right[0] in NUMBER_WORDS

def low_memory_chunks(text, max_chars=145):
    """Clause-aware chunking that avoids mid-phrase, mid-number, and 1-word orphan splits."""
    prepared=prepare_tts_transport_text(text)
    if not prepared:
        return []
    sentences=[s.strip() for s in re.split(r'(?<=[.!?])\s+',prepared) if s.strip() and re.search(r'[A-Za-zÀ-ỹ0-9]',s)]
    result=[]
    for sentence in sentences:
        pending=[sentence]
        while pending:
            value=pending.pop(0).strip().strip(',').strip()
            if not value or not re.search(r'[A-Za-zÀ-ỹ0-9]',value):
                continue
            if len(value)<=max_chars:
                result.append(value)
                continue
            # If slightly over max_chars and splitting would leave a tiny orphan tail, keep whole.
            if len(value)<=180:
                words=value.split()
                if len(words)<=28:
                    # Check if any clause punctuation exists with a balanced tail (>= 24 chars)
                    balanced_clause=[m.end() for m in re.finditer(r'[,;:]\s+',value) if 40<=m.end()<=max_chars and len(value)-m.end()>=24]
                    if not balanced_clause:
                        result.append(value)
                        continue
            cuts=[m.end() for m in re.finditer(r'[,;:]\s+',value) if 35<=m.end()<=max_chars and len(value)-m.end()>=20]
            if cuts:
                cut=cuts[-1]
            else:
                conj=[m.start() for m in re.finditer(r'\s+(?=(?:nhưng|mà|vì|nên|còn|hoặc|hay|thì|là|khi|nếu|để|với|và)\b)',value,flags=re.IGNORECASE) if 45<=m.start()<=max_chars and len(value)-m.start()>=20 and not _is_number_split(value,m.start())]
                if conj:
                    cut=conj[-1]
                else:
                    part_cuts=[m.end() for m in re.finditer(r'\b(?:nha|nhé|ạ|nhỉ|đấy)\s+',value,flags=re.IGNORECASE) if 40<=m.end()<=max_chars and len(value)-m.end()>=20]
                    if part_cuts:
                        cut=part_cuts[-1]
                    else:
                        spaces=[m.start() for m in re.finditer(r'\s+',value) if 35<=m.start()<=max_chars and len(value)-m.start()>=18 and not _is_number_split(value,m.start())]
                        if not spaces:
                            spaces=[m.start() for m in re.finditer(r'\s+',value) if m.start()<=max_chars]
                        cut=spaces[-1] if spaces else max_chars
            head=value[:cut].strip().rstrip(',').strip()
            tail=value[cut:].strip().lstrip(',').strip()
            if head and tail and (len(tail)<22 or len(tail.split())<4) and len(head)+1+len(tail)<=185:
                result.append(head+' '+tail)
            else:
                if head:
                    result.append(head)
                if tail:
                    pending.insert(0,tail)
    return result

def _trim_chunk_edges(audio, np, sr=24000, thresh_db=-45.0, pre_ms=35, post_ms=45):
    """Trim excessive neural dead-air while keeping safe pre-onset and post-offset guards."""
    win=int(sr*0.005) # 5ms window
    if len(audio)<=win*4:
        return audio, 0, 0
    n_win=len(audio)//win
    frames=audio[:n_win*win].reshape(n_win,win)
    rms=np.sqrt(np.mean(frames*frames,axis=1)+1e-12)
    db=20.0*np.log10(rms)
    active=np.where(db>thresh_db)[0]
    if len(active)==0:
        return audio, 0, 0
    pre_samples=int(sr*pre_ms/1000.0)
    post_samples=int(sr*post_ms/1000.0)
    start_sample=max(0,int(active[0]*win)-pre_samples)
    end_sample=min(len(audio),int((active[-1]+1)*win)+post_samples)
    trimmed=audio[start_sample:end_sample].copy()
    # Apply gentle 8ms fade-in/out at trim edges to prevent any DC click
    fade=min(int(sr*0.008),len(trimmed)//4)
    if fade>1:
        ramp=0.5*(1.0-np.cos(np.linspace(0.0,np.pi,fade,dtype=np.float32)))
        trimmed[:fade]*=ramp
        trimmed[-fade:]*=ramp[::-1]
    lead_trimmed_ms=round(start_sample*1000.0/sr,1)
    tail_trimmed_ms=round((len(audio)-end_sample)*1000.0/sr,1)
    return trimmed, lead_trimmed_ms, tail_trimmed_ms

def _chunk_word_alignment(chunk, phonemes, pred_dur, audio, g2p, vocab, np, sr=24000):
    """Map KModel predicted token durations and acoustic RMS dB back to each input word."""
    from vig2p.core import WORD_RE
    if pred_dur is None:
        return []
    durs=[int(x) for x in pred_dur.detach().cpu().view(-1).tolist()]
    # KModel prepends and appends special bos/eos token durations (len(durs) == len(input_ids) + 2)
    inner_durs=durs[1:-1] if len(durs)>=2 else durs
    total_frames=max(1,sum(durs))
    total_samples=len(audio)
    words=[]
    cursor=0
    for m in WORD_RE.finditer(chunk):
        w=m.group(0)
        wp=g2p(w)
        ids=[vocab.get(ch) for ch in wp if vocab.get(ch) is not None]
        n_tok=len(ids)
        # Advance cursor past any punctuation token in inner_durs
        while cursor<len(inner_durs) and n_tok>0 and cursor+n_tok<=len(inner_durs):
            break
        w_durs=inner_durs[cursor:cursor+n_tok] if n_tok>0 else []
        cursor+=n_tok
        # Also consume any trailing space token in inner_durs
        if cursor<len(inner_durs):
            cursor+=1
        frames=int(sum(w_durs))
        # Estimate sample slice for this word
        start_frame=sum(durs[:1+max(0,cursor-n_tok-1)])
        end_frame=min(total_frames,start_frame+max(1,frames))
        s0=int(total_samples*start_frame/total_frames)
        s1=max(s0+1,int(total_samples*end_frame/total_frames))
        seg=audio[s0:min(total_samples,s1)]
        rms=float(np.sqrt(np.mean(seg*seg)+1e-12)) if len(seg)>0 else 1e-6
        rms_db=round(float(20.0*np.log10(max(rms,1e-6))),1)
        words.append({'word':w,'phonemes':wp,'frames':frames,'rmsDb':rms_db})
    return words

def synthesize_streaming(tts, text, output):
    """Keep only one inference audio buffer in memory, trim neural edge dead-air, and concatenate on disk."""
    import soundfile as sf, numpy as np, torch
    from vig2p import VietnameseG2P
    chunks=low_memory_chunks(text)
    if not chunks:
        raise RuntimeError('EMPTY_TEXT_CHUNKS')
    g2p=getattr(tts,'_studio_g2p',None)
    if g2p is None:
        g2p=VietnameseG2P()
        tts._studio_g2p=g2p
    output_path=pathlib.Path(output)
    output_path.parent.mkdir(parents=True,exist_ok=True)
    samples=[]
    with tempfile.TemporaryDirectory(prefix='kokoro-chunks-',dir=str(output_path.parent)) as temp_name:
        temp=pathlib.Path(temp_name)
        parts=[]
        for index,chunk in enumerate(chunks,1):
            stage(f'Synthesizing chunk {index}/{len(chunks)}')
            chunk_before=memory_sample()
            phonemes=g2p(chunk)
            if not phonemes or not phonemes.strip():
                raise RuntimeError('EMPTY_PHONEME_CHUNK')
            ref_s=tts.voicepack[min(len(phonemes)-1,len(tts.voicepack)-1)]
            pred_dur=None
            with torch.no_grad():
                out=tts.model(phonemes,ref_s,speed=1.0,return_output=True)
                audio=out.audio.squeeze().cpu().numpy().astype(np.float32)
                pred_dur=out.pred_dur
            if len(audio)==0:
                raise RuntimeError('EMPTY_AUDIO_CHUNK')
            word_diag=_chunk_word_alignment(chunk,phonemes,pred_dur,audio,g2p,tts.model.vocab,np)
            trimmed,lead_ms,tail_ms=_trim_chunk_edges(audio,np,sr=24000)
            lead_pad=np.zeros(int(24000*0.060),dtype=np.float32) if index==1 else np.zeros(0,dtype=np.float32)
            if index<len(chunks):
                last_char=chunk.strip()[-1] if chunk.strip() else ''
                if last_char in '.!?':
                    pause_ms=190
                elif last_char in ',;:':
                    pause_ms=115
                else:
                    pause_ms=45
                tail_pad=np.zeros(int(24000*pause_ms/1000.0),dtype=np.float32)
            else:
                tail_pad=np.zeros(int(24000*0.090),dtype=np.float32)
            part_audio=np.concatenate([lead_pad,trimmed,tail_pad],axis=0)
            part=temp/f'{index:03d}.wav'
            sf.write(part,part_audio,24000,subtype='PCM_16')
            with part.open('rb+') as saved:
                os.fsync(saved.fileno())
            del audio,trimmed,part_audio,pred_dur,phonemes
            gc.collect()
            chunk_after=memory_sample()
            samples.append({
                'index':index,
                'characters':len(chunk),
                'text':chunk,
                'leadTrimmedMs':lead_ms,
                'tailTrimmedMs':tail_ms,
                'words':word_diag,
                'before':chunk_before,
                'after':chunk_after,
            })
            parts.append(part)
        listing=temp/'concat.txt'
        listing.write_text(''.join("file '"+str(part.resolve()).replace('\\','/').replace("'","'\\''")+"'\n" for part in parts),encoding='utf-8')
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(listing),'-c:a','pcm_s16le',str(output_path)],check=True)
        with output_path.open('rb+') as saved:
            os.fsync(saved.fileno())
    return chunks,samples

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
                with low_memory_torch_loading(torch):
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
            stage('Synthesizing')
            inference_before=memory_sample()
            if re.search(r'\d',req['text']): raise RuntimeError('UNNORMALIZED_NUMERIC_INPUT')
            chunks,chunk_samples=synthesize_streaming(tts,req['text'],req['output'])
            inference_after=memory_sample()
        final=memory_sample()
        if final: measurements.append(final)
        active=False
        metrics={'inputCharacters':len(req['text']),'sentenceChunks':len(chunks),'maxSentenceCharacters':max(map(len,chunks),default=0),'elapsedMs':round((time.monotonic()-started)*1000),'peakRssMiB':max((m['peakRssMiB'] for m in measurements),default=None),'peakPrivateMiB':max((m['privateMiB'] for m in measurements),default=None),'minimumAvailableMiB':min((m['availableMiB'] for m in measurements),default=None),'modelBefore':before,'modelAfter':after,'modelLoadStrategy':'MMAP_ASSIGN','chunkSamples':chunk_samples}
        metrics.update({'runtimeBefore':runtime_before,'runtimeAfter':runtime_after,'inferenceBefore':inference_before,'inferenceAfter':inference_after})
        emit({'ok':True,'metrics':metrics})
    except Exception as e:
        active=False
        allocation=allocation_failure(e)
        emit({'ok':False,'category':'ALLOCATION_FAILURE' if allocation else 'UNKNOWN','error':('ALLOCATION_FAILURE' if allocation else 'UNKNOWN')+': Kokoro '+type(e).__name__,'details':{'errorType':type(e).__name__,'winerror':getattr(e,'winerror',None),'errno':getattr(e,'errno',None),'allocatorFailure':allocation}})
