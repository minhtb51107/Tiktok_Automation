"""Offline checkpoint tests. No model, GPU or network."""
import pathlib
import shutil
import subprocess
import tempfile
import unittest
import wave
from kokoro_chunks import ChunkCheckpoint, digest

def write_pcm(path, frames):
    with wave.open(str(path), 'wb') as stream:
        stream.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
        stream.writeframes(frames)

class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.sandbox = tempfile.TemporaryDirectory()
        self.addCleanup(self.sandbox.cleanup)
        self.root = pathlib.Path(self.sandbox.name).resolve()
        self.identity = {'inputHash': digest('first second'), 'voiceFingerprint': 'voice-a'}
        self.plan = ['first', 'second']
        self.a = b'\x63\x01' * 1200
        self.b = b'\x32\x00' * 1800

    def checkpoint(self):
        return ChunkCheckpoint(self.root, self.identity, self.plan)

    def test_restart_preserves_only_manifest_committed_parts(self):
        old = self.checkpoint()
        with old.open():
            old.load()
            old.complete(0, lambda path: write_pcm(path, self.a), {})
            # Simulate a crash after file promotion but before the manifest commit.
            write_pcm(old.trusted_path(1), self.b)
        new = self.checkpoint()
        with new.open():
            new.load()
            self.assertEqual([row['status'] for row in new.manifest['chunks']], ['COMPLETED', 'PENDING'])
            with self.assertRaises(ValueError):
                new.parts()
            new.complete(1, lambda path: write_pcm(path, self.b), {})
            self.assertEqual(len(new.parts()), 2)

    def test_corrupt_or_changed_input_is_not_reused(self):
        old = self.checkpoint()
        with old.open():
            old.load()
            old.complete(0, lambda path: write_pcm(path, self.a), {})
            write_pcm(old.trusted_path(0), b'\x00\x00' * 1200)  # Same length and format, changed hash.
        new = self.checkpoint()
        with new.open():
            new.load()
            self.assertEqual(new.manifest['chunks'][0]['status'], 'PENDING')
        self.identity['voiceFingerprint'] = 'voice-b'
        self.assertNotEqual(self.checkpoint().directory, new.directory)
        self.plan.reverse()
        self.assertNotEqual(self.checkpoint().directory, new.directory)

    def test_concurrent_worker_cannot_write_same_checkpoint(self):
        first = self.checkpoint()
        second = self.checkpoint()
        with first.open():
            with self.assertRaises(OSError):
                with second.open():
                    self.fail('Concurrent checkpoint lock acquired')
        with second.open():
            second.load()

    def test_assembly_preserves_exact_pcm_and_rejects_incomplete_sequence(self):
        checkpoint = self.checkpoint()
        output = self.root / 'base.wav'
        with checkpoint.open():
            checkpoint.load()
            with self.assertRaises(ValueError):
                checkpoint.assemble(output)
            self.assertFalse(output.exists())
            checkpoint.complete(0, lambda path: write_pcm(path, self.a), {})
            checkpoint.complete(1, lambda path: write_pcm(path, self.b), {})
            checkpoint.assemble(output)
            with wave.open(str(output), 'rb') as stream:
                self.assertEqual(stream.readframes(stream.getnframes()), self.a + self.b)
            if shutil.which('ffmpeg'):
                listing = self.root / 'original-concat.txt'
                listing.write_text(''.join("file '" + part.as_posix() + "'\n" for part in checkpoint.parts()), encoding='utf8')
                baseline = self.root / 'original-concat.wav'
                subprocess.run(['ffmpeg', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', str(listing),
                                '-c:a', 'pcm_s16le', str(baseline)], check=True)
                with wave.open(str(baseline), 'rb') as stream:
                    self.assertEqual(stream.readframes(stream.getnframes()), self.a + self.b)

if __name__ == '__main__':
    unittest.main()
