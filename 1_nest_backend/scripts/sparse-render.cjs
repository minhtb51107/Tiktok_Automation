const path = require('node:path');

async function verifyStillImages(uris, command) {
  for (const uri of uris) {
    // The render worker has already resolved and restricted all media URIs.
    // Only formats that the probe can distinguish from animated media qualify.
    if (!uri.startsWith('http://127.0.0.1:')) return false;
    const codec = await command('ffprobe', [
      '-v', 'error', '-rw_timeout', '3000000', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', uri,
    ], true).catch(() => '');
    if (!['mjpeg', 'png'].includes(codec.trim())) return false;
  }
  return true;
}

async function renderSparse({ plan, dir, renderer, options, manifest, background, metrics, command, tick, check }) {
  const { fps, width, height, frameRange: [start, end] } = manifest;
  const total = end - start + 1;
  const timelineFps = options.inputProps.timeline.fps;
  const fpsScale = fps / timelineFps;
  const tStart = Math.floor(start / fpsScale);
  const tEnd = Math.floor(end / fpsScale);
  const tTotal = tEnd - tStart + 1;
  const layer = renderLayer => ({
    ...options, inputProps: { ...options.inputProps, renderLayer },
    composition: { ...options.composition, props: { ...options.composition.props, renderLayer } },
  });
  const cardOptions = layer('CARDS');
  const cardInputs = [];
  const captureStarted = Date.now();
  for (const state of plan.states) {
    check();
    const output = path.join(dir, `card-${state.capture}.png`);
    tick('Capturing static Threads card', cardInputs.length, plan.states.length);
    await renderer.renderStill({ ...cardOptions, frame: state.capture, output, imageFormat: 'png', overwrite: false });
    cardInputs.push(output);
  }
  metrics.cardCaptures = cardInputs.length;
  metrics.cardCaptureMs = Date.now() - captureStarted;

  check();
  tick('Collecting existing timeline audio', 0, total);
  const audioStart = Date.now();
  let last = 0;
  const audio = await renderer.renderFrames({
    ...layer('AUDIO'),
    outputDir: null, imageFormat: 'none', frameRange: [tStart, tEnd], concurrency: 1,
    onStart() {}, onFrameUpdate(done) {
      if (Date.now() - last >= 1000 || done === tTotal) {
        last = Date.now();
        tick('Collecting existing timeline audio', Math.min(total, Math.round(done * fpsScale)), total);
      }
    },
  });
  metrics.audioCollectionMs = Date.now() - audioStart;
  await renderer.stitchFramesToVideo({
    assetsInfo: audio.assetsInfo, codec: 'wav', audioCodec: 'pcm-16',
    outputLocation: path.join(dir, 'mix.wav'), fps: timelineFps, width, height,
    cancelSignal: options.cancelSignal,
  });
  metrics.audioMixMs = Date.now() - audioStart - metrics.audioCollectionMs;

  await options.puppeteerInstance?.close({ silent: true }).catch(() => {});

  check();
  const compositingStarted = Date.now();
  tick('Compositing gameplay and card states');
  const spanAtFps = Math.round(plan.span * fpsScale);
  const phase = plan.loop ? start % spanAtFps : start;
  const filters = [`[0:v]trim=start_frame=${phase},setpts=N/(${fps}*TB)[base]`];
  let input = 'base';
  for (const [i, state] of plan.states.entries()) {
    const output = `v${i}`;
    // Half-frame margin avoids floating-point rounding at the frame boundary.
    const sStart = Math.round(state.start * fpsScale);
    const sEnd = Math.round(state.end * fpsScale);
    const from = (sStart - start - 0.5) / fps, until = (sEnd - start - 0.5) / fps;
    filters.push(`[${input}][${i + 1}:v]overlay=enable='gte(t,${from})*lt(t,${until})'[${output}]`);
    input = output;
  }
  const filterFile = path.join(dir, 'sparse-filters.txt');
  await require('node:fs/promises').writeFile(filterFile, filters.join(';'));
  await command('ffmpeg', [
    '-v', 'error', '-n', ...(plan.loop ? ['-stream_loop', '-1'] : []), '-i', background,
    ...cardInputs.flatMap(image => ['-i', image]), '-filter_complex_threads', '1',
    '-filter_complex_script', filterFile, '-map', `[${input}]`, '-frames:v', String(total),
    '-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    path.join(dir, 'video-silent.mp4'),
  ], true);
  metrics.compositeAndEncodeMs = Date.now() - compositingStarted;
}

module.exports = { renderSparse, verifyStillImages };
