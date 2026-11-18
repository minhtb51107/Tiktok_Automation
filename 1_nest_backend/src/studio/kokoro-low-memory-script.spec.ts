import { readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from '@jest/globals';

describe('low-memory Kokoro execution adapter', () => {
  const worker = readFileSync(
    path.resolve('scripts/kokoro-studio.py'),
    'utf8',
  );
  const batch = readFileSync(
    path.resolve('scripts/kokoro-low-memory-batch.cjs'),
    'utf8',
  );

  it('maps local weights, assigns them once and streams inference chunks to disk', () => {
    expect(worker).toContain("kwargs.setdefault('mmap',True)");
    expect(worker).toContain('assign=True');
    expect(worker).toContain('synthesize_streaming(tts,req');
    expect(worker).toContain("subprocess.run(['ffmpeg'");
    expect(worker).toContain('gc.collect()');
    expect(worker).toContain("modelLoadStrategy':'MMAP_ASSIGN'");
  });

  it('uses StudioService scene actions so every completed WAV persists', () => {
    expect(batch).toContain('new StudioService(new ScraperService())');
    expect(batch).toContain('service.voiceAction(');
    expect(batch).toContain("action:'GENERATE'");
    expect(batch).toContain('service.onModuleDestroy()');
    expect(batch).not.toContain('fetch(');
  });
});
