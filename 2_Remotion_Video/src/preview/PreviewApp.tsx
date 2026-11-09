import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import type {
  ContentStyle,
  VideoProject,
  VideoPreviewProps,
} from '../../../1_nest_backend/src/video-pipeline/contracts';
import { createSyntheticVideoProject } from '../../../1_nest_backend/src/video-pipeline/fixtures/synthetic-thread.fixture';
import { createRemotionPreviewRequest } from '../../../1_nest_backend/src/video-pipeline/preview-adapter';
import { editStoryboardScene } from '../../../1_nest_backend/src/video-pipeline/storyboard-editor';
import { buildVideoTimeline } from '../../../1_nest_backend/src/video-pipeline/timeline-engine';
import {
  FunnyTimelinePreview,
  SeriousTimelinePreview,
} from '../video-pipeline/TimelinePreviewComposition';

const PAGE_BOOT_STARTED = performance.now();

const withTimeline = (project: VideoProject): VideoProject => ({
  ...project,
  timeline: buildVideoTimeline({
    projectId: project.id,
    style: project.style,
    fps: 60,
    width: 1080,
    height: 1920,
    introDurationMs: 1000,
    outroDurationMs: 500,
    scenes: project.storyboard,
    audioAssets: project.audioAssets,
    mediaAssets: project.mediaAssets,
  }),
});

const initialProjects = (): Record<ContentStyle, VideoProject> => ({
  FUNNY: withTimeline(createSyntheticVideoProject('FUNNY')),
  SERIOUS: withTimeline(createSyntheticVideoProject('SERIOUS')),
});

export const PreviewApp: React.FC = () => {
  const [style, setStyle] = useState<ContentStyle>('FUNNY');
  const [projects, setProjects] = useState(initialProjects);
  const [selectedSceneId, setSelectedSceneId] = useState('funny-scene-post');
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [simulateMissingAsset, setSimulateMissingAsset] = useState(false);
  const [loadTimeMs, setLoadTimeMs] = useState(0);
  const [displayTextDraft, setDisplayTextDraft] = useState(
    'Một bài đăng mở đầu cho tình huống giả lập',
  );
  const playerRef = useRef<PlayerRef>(null);
  const project = projects[style];
  const request = useMemo(() => createRemotionPreviewRequest(project), [project]);
  const selectedScene =
    project.storyboard.find((scene) => scene.id === selectedSceneId) ??
    project.storyboard[0];
  const inputProps: VideoPreviewProps = useMemo(
    () => ({
      ...request.inputProps,
      mediaAssets: request.inputProps.mediaAssets.map((asset) =>
        simulateMissingAsset && asset.id === 'meme-reaction'
          ? { ...asset, availability: 'MISSING' }
          : asset,
      ),
    }),
    [request, simulateMissingAsset],
  );
  const PreviewComponent =
    style === 'FUNNY' ? FunnyTimelinePreview : SeriousTimelinePreview;
  const activeTimelineScene = project.timeline?.scenes.find(
    (scene) => currentFrame >= scene.startFrame && currentFrame < scene.endFrame,
  );

  useEffect(() => {
    setLoadTimeMs(Math.round(performance.now() - PAGE_BOOT_STARTED));
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (event: { detail: { frame: number } }) =>
      setCurrentFrame(event.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = (event: { detail: { error: Error } }) =>
      setRuntimeError(event.detail.error.message);
    player.addEventListener('frameupdate', onFrame);
    player.addEventListener('seeked', onFrame);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    player.addEventListener('error', onError);
    return () => {
      player.removeEventListener('frameupdate', onFrame);
      player.removeEventListener('seeked', onFrame);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
      player.removeEventListener('error', onError);
    };
  }, [style]);

  const chooseStyle = (nextStyle: ContentStyle) => {
    playerRef.current?.pause();
    playerRef.current?.seekTo(0);
    setStyle(nextStyle);
    setSelectedSceneId(projects[nextStyle].storyboard[0].id);
    setCurrentFrame(0);
    setRuntimeError(null);
    setSimulateMissingAsset(false);
  };

  const updateDisplayText = (displayText: string) => {
    try {
      const updatedStoryboard = editStoryboardScene(
        project.storyboard,
        selectedScene.id,
        { displayText },
        ['DISPLAY_TEXT'],
        'local-preview-user',
      );
      const updated = withTimeline({ ...project, storyboard: updatedStoryboard });
      setProjects((current) => ({ ...current, [style]: updated }));
      setRuntimeError(null);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    setDisplayTextDraft(selectedScene.displayText);
  }, [selectedScene.id, style]);

  useEffect(() => {
    if (displayTextDraft === selectedScene.displayText) return;
    const timeout = window.setTimeout(
      () => updateDisplayText(displayTextDraft),
      250,
    );
    return () => window.clearTimeout(timeout);
  }, [displayTextDraft, selectedScene.displayText]);

  const synchronizeAudioAtFrame = (frame: number, attempt = 0) => {
    const timelineScene = project.timeline?.scenes.find(
      (scene) =>
        scene.audioStartFrame !== undefined &&
        scene.audioEndFrame !== undefined &&
        frame >= scene.audioStartFrame &&
        frame < scene.audioEndFrame,
    );
    const audioAsset = project.audioAssets.find(
      (asset) => asset.id === timelineScene?.scene.audioAssetId,
    );
    if (timelineScene?.audioStartFrame !== undefined && audioAsset) {
      const expectedSeconds = (frame - timelineScene.audioStartFrame) / request.fps;
      const container = playerRef.current?.getContainerNode();
      const audio = Array.from(container?.querySelectorAll('audio') ?? []).find(
        (element) => decodeURI(element.src).endsWith(audioAsset.uri),
      );
      if (!audio) {
        if (attempt < 5) {
          window.setTimeout(
            () => synchronizeAudioAtFrame(frame, attempt + 1),
            50,
          );
        }
        return;
      }
      const synchronize = () => {
        audio.currentTime = expectedSeconds;
      };
      if (audio.readyState >= 1) synchronize();
      else audio.addEventListener('loadedmetadata', synchronize, { once: true });
    }
  };

  const seekTo = (frame: number) => {
    const bounded = Math.max(0, Math.min(frame, request.durationInFrames - 1));
    playerRef.current?.seekTo(bounded);
    window.setTimeout(() => synchronizeAudioAtFrame(bounded), 0);
    setCurrentFrame(bounded);
  };

  const togglePlayback = () => {
    const player = playerRef.current;
    if (!player) return;
    if (player.isPlaying()) {
      player.pause();
      return;
    }
    player.play();
    window.setTimeout(
      () => synchronizeAudioAtFrame(player.getCurrentFrame()),
      250,
    );
  };

  const unavailableAssets = [
    ...inputProps.audioAssets,
    ...inputProps.mediaAssets,
  ].filter((asset) => asset.availability !== 'AVAILABLE');

  return (
    <main className="app-shell">
      <header>
        <div>
          <p className="eyebrow">Synthetic offline fixture</p>
          <h1>Interactive Video Timeline Preview</h1>
        </div>
        <div className="style-switcher" role="group" aria-label="Content style">
          {(['FUNNY', 'SERIOUS'] as const).map((item) => (
            <button
              data-testid={`style-${item.toLowerCase()}`}
              className={item === style ? 'active' : ''}
              key={item}
              onClick={() => chooseStyle(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      </header>

      <section className="workspace">
        <div className="player-panel">
          <div data-testid="player" className="player-frame">
            <Player
              key={style}
              ref={playerRef}
              component={PreviewComponent}
              inputProps={inputProps}
              durationInFrames={request.durationInFrames}
              fps={request.fps}
              compositionWidth={project.timeline?.width ?? 1080}
              compositionHeight={project.timeline?.height ?? 1920}
              acknowledgeRemotionLicense
              style={{ height: '100%', width: '100%' }}
            />
          </div>

          <div className="transport">
            <button type="button" onClick={togglePlayback}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <input
              data-testid="seek"
              aria-label="Seek frame"
              max={request.durationInFrames - 1}
              min={0}
              onInput={(event) => seekTo(Number(event.currentTarget.value))}
              type="range"
              value={currentFrame}
            />
            <output data-testid="current-frame">
              Frame {currentFrame} · {(currentFrame / request.fps).toFixed(2)}s
            </output>
          </div>

          <dl className="metrics">
            <div><dt>Total</dt><dd>{request.durationInFrames} frames · {(request.durationInFrames / request.fps).toFixed(2)}s</dd></div>
            <div><dt>Active scene</dt><dd data-testid="active-scene">{activeTimelineScene?.scene.id ?? 'intro/outro'}</dd></div>
            <div><dt>Page load</dt><dd data-testid="load-time">{loadTimeMs} ms</dd></div>
          </dl>
        </div>

        <aside>
          <section className="card">
            <h2>Scenes</h2>
            <ol className="scene-list">
              {project.timeline?.scenes.map((item) => (
                <li key={item.scene.id}>
                  <button
                    data-testid={`scene-${item.scene.id}`}
                    className={item.scene.id === selectedScene.id ? 'selected' : ''}
                    onClick={() => {
                      setSelectedSceneId(item.scene.id);
                      seekTo(item.startFrame);
                    }}
                    type="button"
                  >
                    <span>{item.scene.order + 1}. {item.scene.displayText}</span>
                    <small>{item.startFrame}–{item.endFrame}</small>
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section className="card editor-card">
            <h2>Scene text</h2>
            <label htmlFor="display-text">Display text</label>
            <textarea
              data-testid="display-text"
              id="display-text"
              onChange={(event) => setDisplayTextDraft(event.target.value)}
              value={displayTextDraft}
            />
            <p data-testid="revision">
              Revision {selectedScene.manualOverride.revision} · Locks:{' '}
              {selectedScene.manualOverride.lockedFields.join(', ') || 'none'}
            </p>
          </section>

          <section className="card">
            <h2>Assets</h2>
            <label className="check-row">
              <input
                data-testid="simulate-missing"
                checked={simulateMissingAsset}
                onChange={(event) => setSimulateMissingAsset(event.target.checked)}
                type="checkbox"
              />
              Simulate missing meme
            </label>
            <p data-testid="asset-status" className={unavailableAssets.length ? 'status-error' : 'status-ok'}>
              {unavailableAssets.length
                ? `Missing: ${unavailableAssets.map((asset) => asset.id).join(', ')}`
                : `${inputProps.audioAssets.length} audio + ${inputProps.mediaAssets.length} media ready`}
            </p>
          </section>

          {runtimeError ? <p data-testid="runtime-error" className="runtime-error">{runtimeError}</p> : null}
        </aside>
      </section>
    </main>
  );
};
