"""Durable PCM checkpoints for the local Kokoro worker."""
import contextlib
import hashlib
import json
import os
import pathlib
import tempfile
import wave

RATE = 24000

def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()

def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))

def file_digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def pcm_count(path):
    with wave.open(str(path), 'rb') as stream:
        if (stream.getnchannels(), stream.getsampwidth(), stream.getframerate(), stream.getcomptype()) != (1, 2, RATE, 'NONE'):
            raise ValueError('Unsupported PCM checkpoint format')
        remaining = expected = stream.getnframes()
        while remaining:
            count = min(remaining, RATE)
            if len(stream.readframes(count)) != count * 2:
                raise ValueError('Truncated PCM checkpoint')
            remaining -= count
        if not expected:
            raise ValueError('Empty PCM checkpoint')
        return expected

def atomic_json(path, value):
    fd, name = tempfile.mkstemp(dir=path.parent, suffix='.json.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(canonical(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        pathlib.Path(name).unlink(missing_ok=True)

@contextlib.contextmanager
def checkpoint_lock(path):
    # The OS releases the lock on worker exit, including an emergency kill.
    with path.open('a+b') as lock:
        lock.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield

class ChunkCheckpoint:
    def __init__(self, directory, identity, chunks):
        self.plan = [{'index': index, 'textHash': digest(text)} for index, text in enumerate(chunks, 1)]
        key = digest(canonical({'identity': identity, 'plan': self.plan}))
        self.directory = directory / key
        self.directory.mkdir(parents=True, exist_ok=True)
        if self.directory.resolve() != self.directory.absolute():
            raise ValueError('Uncontrolled chunk checkpoint path')
        self.file = self.directory / 'manifest.json'
        self.header = {'schemaVersion': 'tts-chunks/1', 'synthesisKey': key, **identity}
        self.manifest = None

    def open(self):
        return checkpoint_lock(self.directory / 'worker.lock')

    def load(self):
        empty = [{**entry, 'status': 'PENDING', 'relativePath': None, 'sha256': None,
                  'sampleCount': None, 'durationMs': None} for entry in self.plan]
        self.manifest = {**self.header, 'chunks': empty}
        if self.file.exists():
            try:
                old = json.loads(self.file.read_text(encoding='utf-8'))
                if all(old.get(k) == v for k, v in self.header.items()) and len(old['chunks']) == len(empty):
                    for index, entry in enumerate(old['chunks']):
                        if self.valid(index, entry):
                            self.manifest['chunks'][index] = entry
            except (OSError, ValueError, TypeError, KeyError, AttributeError):
                pass
        self.save()

    def trusted_path(self, index):
        return self.directory / f'{index + 1:03d}.wav'

    def valid(self, index, entry):
        target = self.trusted_path(index)
        try:
            return (entry['status'] == 'COMPLETED' and entry['index'] == index + 1 and
                    entry['textHash'] == self.plan[index]['textHash'] and
                    entry['relativePath'] == target.name and target.resolve() == target.absolute() and
                    file_digest(target) == entry['sha256'] and pcm_count(target) == entry['sampleCount'] and
                    round(entry['sampleCount'] / 24) == entry['durationMs'])
        except (OSError, ValueError, KeyError, TypeError, wave.Error, EOFError):
            return False

    def save(self):
        atomic_json(self.file, self.manifest)

    def complete(self, index, writer, diagnostics):
        fd, name = tempfile.mkstemp(dir=self.directory, suffix='.wav.tmp')
        os.close(fd)
        tmp = pathlib.Path(name)
        try:
            writer(tmp)
            with tmp.open('rb+') as stream:
                os.fsync(stream.fileno())
            count = pcm_count(tmp)
            target = self.trusted_path(index)
            entry = {**self.plan[index], 'status': 'COMPLETED', 'relativePath': target.name,
                     'sha256': file_digest(tmp), 'sampleCount': count, 'durationMs': round(count/24),
                     'diagnostics': diagnostics}
            os.replace(tmp, target)
            self.manifest['chunks'][index] = entry
            self.save()
        finally:
            tmp.unlink(missing_ok=True)

    def parts(self):
        for index, entry in enumerate(self.manifest['chunks']):
            if not self.valid(index, entry):
                raise ValueError('Incomplete or corrupt PCM checkpoint sequence')
        return [self.trusted_path(i) for i in range(len(self.plan))]

    def assemble(self, output):
        # The previous FFmpeg concat decoded PCM and re-encoded it as PCM_16.
        # Stream the same frames directly so a worker stop cannot orphan FFmpeg.
        parts = self.parts()
        with wave.open(str(output), 'wb') as combined:
            combined.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
            for part in parts:
                with wave.open(str(part), 'rb') as source:
                    while frames := source.readframes(RATE):
                        combined.writeframesraw(frames)
        if pcm_count(output) != sum(entry['sampleCount'] for entry in self.manifest['chunks']):
            raise ValueError('PCM assembly sample count mismatch')
        with output.open('rb+') as saved:
            os.fsync(saved.fileno())
