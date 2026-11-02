import {shiftSourceInMs} from '../../../1_nest_backend/src/video-pipeline/editing';
import { CanvasTransform } from "./CanvasTransform";
import { EditableTimeline } from "./EditableTimeline";
import { GlobalBackgroundInspector } from "./GlobalBackgroundInspector";
import { autoSegment } from "../../../1_nest_backend/src/video-pipeline/editing";
import type { EditorClip } from "./editor-timeline";
import { useState, useEffect, useRef, useMemo } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type { StudioSession } from "../../../1_nest_backend/src/studio/studio.contracts";
import type {
  EditorSettings,
  StudioMediaAsset,
} from "../../../1_nest_backend/src/studio/editor.types";
import type { LibraryAsset } from "../../../1_nest_backend/src/studio/public-assets";
import { editorSettings } from "../../../1_nest_backend/src/video-pipeline/editor-state";
import { buildStudioPreview } from "../../../1_nest_backend/src/video-pipeline/studio-preview";
import {
  normalizeVisual,
  defaultBgm,
} from "../../../1_nest_backend/src/video-pipeline/scene-visual";
import { SeriousTimelinePreview } from "../video-pipeline/TimelinePreviewComposition";
import { EditorInspector } from "./EditorInspector";
import { ContextAssets } from "./ContextAssets";
import { editorClips, type EditorObject } from "./editor-timeline";
import "./editor.css";
interface Draft {
  settings: EditorSettings;
  displayEdits: Record<string, string>;
}
const serialize = (d: Draft) => JSON.stringify(d);
const api = async (url: string, method = "GET", body?: unknown) => {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok)
    throw Error(j.error?.message || j.message || "Local API request failed");
  return j.data ?? j;
};
export function ProfessionalEditor({
  session,
  busy,
  accept,
  onDirty,
  onNavigate,
}: {
  session: StudioSession;
  busy: boolean;
  accept: (s: StudioSession) => void;
  onDirty: (v: boolean) => void;
  onNavigate?: (step: string) => void;
  prepare?: () => Promise<void>;
}) {
  const initial = () => ({
    settings: editorSettings(session),
    displayEdits: {},
  });
  const [draft, setDraft] = useState<Draft>(initial),
    [baseline, setBaseline] = useState(() => serialize(initial())),
    [selected, setSelected] = useState(
      () => session.items.find((i) => i.selected)?.id || "",
    ),
    [object, setObject] = useState<EditorObject>("CARD");
  const [past, setPast] = useState<Draft[]>([]),
    [future, setFuture] = useState<Draft[]>([]),
    [tab, setTab] = useState("SCENES"),
    [category, setCategory] = useState("BACKGROUND"),
    [picker, setPicker] = useState<EditorObject>("BACKGROUND");
  const [library, setLibrary] = useState<LibraryAsset[]>([]),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [frame, setFrame] = useState(0),
    [safe, setSafe] = useState(true),
    [stageSize, setStageSize] = useState({ width: 350, height: 600 });
  const [theme, setTheme] = useState(
    () => localStorage.getItem("studio-appearance") || "DARK",
  );
  const [selectedClip, setSelectedClip] = useState("");
  const gesture = useRef<Draft | null>(null);
  const player = useRef<PlayerRef>(null),
    stage = useRef<HTMLDivElement>(null),
    loadedRevision = useRef(session.revision),
    saving = useRef(false),
    draftRef = useRef(draft);
  draftRef.current = draft;
  const dirty = serialize(draft) !== baseline,
    blocked = busy || working;
  const base = "/api/studio/sessions/" + session.id;
  useEffect(() => {
    document.documentElement.dataset.studioTheme = theme;
    localStorage.setItem("studio-appearance", theme);
    return () => {
      delete document.documentElement.dataset.studioTheme;
    };
  }, [theme]);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    let alive = true;
    api("/api/studio/public-assets")
      .then((rows) => {
        if (alive)
          setLibrary((old) =>
            rows.map((a: LibraryAsset) => ({
              ...a,
              ...old.find((x) => x.id === a.id),
            })),
          );
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver((rows) => {
      const r = rows[0].contentRect;
      setStageSize({ width: r.width, height: r.height });
    });
    if (stage.current) observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (loadedRevision.current === session.revision) return;
    if (dirty && !saving.current) {
      setError(
        "Project revision changed. Unsaved edits are retained; save will check conflicts.",
      );
      return;
    }
    loadedRevision.current = session.revision;
    const next = initial();
    setDraft(next);
    setBaseline(serialize(next));
    setPast([]);
    setFuture([]);
    saving.current = false;
  }, [session.revision]);
  const mergeDetails = async (ids: string[]) => {
    const details: LibraryAsset[] = [];
    for (const id of ids) {
      if (!id.startsWith("pub-")) continue;
      const a = await api("/api/studio/public-assets/" + id + "/info");
      details.push(a);
      setLibrary((rows) =>
        rows.some((r) => r.id === id)
          ? rows.map((r) => (r.id === id ? { ...r, ...a } : r))
          : [...rows, a],
      );
    }
    return details;
  };
  useEffect(() => {
    const ids = new Set<string>();
    const s = editorSettings(session);
    if (s.backgroundMusic?.assetId) ids.add(s.backgroundMusic.assetId);
    if (s.backgroundId) ids.add(s.backgroundId);
    for (const c of s.backgroundTracks || []) ids.add(c.assetId);
    for (const x of s.scenes) {
      if (x.visual?.backgroundId) ids.add(x.visual.backgroundId);
      if (x.visual?.sfx.assetId) ids.add(x.visual.sfx.assetId);
      if (x.visual?.meme.assetId) ids.add(x.visual.meme.assetId);
    }
    void mergeDetails([...ids]).catch((e) => setError(e.message));
  }, [session.id]);
  const change = (next: Draft) => {
    player.current?.pause();
    setPast((rows) => [...rows.slice(-29), structuredClone(draftRef.current)]);
    setFuture([]);
    setDraft(next);
    setNotice("");
    setError("");
  };
  const update = (
    id: string,
    patch: Partial<EditorSettings["scenes"][number]>,
  ) =>
    change({
      ...draftRef.current,
      settings: {
        ...draftRef.current.settings,
        scenes: draftRef.current.settings.scenes.map((s) =>
          s.itemId === id ? { ...s, ...patch } : s,
        ),
      },
    });
  const globalUpdate = (patch: Partial<EditorSettings>) =>
    change({
      ...draftRef.current,
      settings: { ...draftRef.current.settings, ...patch },
    });
  const draftSession = useMemo(
    () => ({
      ...session,
      editor: draft.settings,
      items: session.items.map((i) => ({
        ...i,
        displayText: draft.displayEdits[i.id] ?? i.displayText,
      })),
    }),
    [session, draft],
  );
  const live = useMemo(() => {
    try {
      const ids = new Set<string>();
      if (draft.settings.backgroundId) ids.add(draft.settings.backgroundId);
      for (const c of draft.settings.backgroundTracks || []) ids.add(c.assetId);
      if (draft.settings.backgroundMusic?.assetId)
        ids.add(draft.settings.backgroundMusic.assetId);
      for (const x of draft.settings.scenes) {
        x.mediaAssetIds.forEach((id) => ids.add(id));
        const v = normalizeVisual(x.visual);
        if (v.backgroundId) ids.add(v.backgroundId);
        if (v.meme.assetId) ids.add(v.meme.assetId);
        if (v.sfx.assetId) ids.add(v.sfx.assetId);
      }
      const assets = library.filter((a) => ids.has(a.id));
      if (assets.some((a) => a.kind === "AUDIO" && !a.durationMs))
        return { error: "Reading selected audio metadata…", built: null };
      return { built: buildStudioPreview(draftSession, assets), error: "" };
    } catch (e) {
      return { built: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [draftSession, library]);
  const project = live.built?.project,
    timeline = project?.timeline,
    request = live.built?.preview.request;
  const clips = useMemo(() => (project ? editorClips(project) : []), [project]);
  const current = draft.settings.scenes.find((s) => s.itemId === selected),
    item = session.items.find((i) => i.id === selected),
    active = timeline?.scenes.find(
      (s) => frame >= s.startFrame && frame < s.endFrame,
    );
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) =>
        setFrame(e.detail.frame),
      onError = (e: { detail: { error: Error } }) =>
        setError(e.detail.error.message);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("seeked", onFrame);
    p.addEventListener("error", onError);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("seeked", onFrame);
      p.removeEventListener("error", onError);
    };
  }, [!!request]);
  const seek = (n: number) => {
    player.current?.pause();
    player.current?.seekTo(
      Math.max(0, Math.min((timeline?.totalFrames || 1) - 1, Math.round(n))),
    );
    setFrame(n);
  };
  const select = (id: string, o: EditorObject = "CARD", seekToScene = true) => {
    setSelected(id);
    setObject(o);
    const t = timeline?.scenes.find((s) => s.scene.id === id);
    if (t && seekToScene) seek(t.startFrame);
  };
  const choose = (o: EditorObject) => {
    setObject(o);
    setPicker(o);
    setCategory(
      o === "MEME"
        ? "MEME"
        : o === "SFX"
          ? "SFX"
          : o === "BGM"
            ? "BGM"
            : "BACKGROUND",
    );
    setTab("ASSETS");
  };
  const action = async (fn: () => Promise<void>) => {
    setWorking(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };
  const assign = (id: string, role: EditorObject,atFrame?:number) => {
    const dest=atFrame!==undefined?timeline?.scenes.find(s=>atFrame>=s.startFrame&&atFrame<s.endFrame):undefined;
    const target=draftRef.current.settings.scenes.find(s=>s.itemId===dest?.scene.id)||current;
    if(!target)return;
    const localMs=atFrame!==undefined?Math.floor(Math.max(0,atFrame-(dest?.startFrame||0))*1000/(timeline?.fps||30)):undefined;
    void action(async () => {
      const details = await mergeDetails([id]);
      const a =
        details[0] ||
        session.studioMedia?.find((a) => a.id === id) ||
        library.find((a) => a.id === id);
      const v = normalizeVisual(target.visual);
      if (role === "BACKGROUND") {
        const startMs=atFrame===undefined?0:Math.floor(atFrame*1000/(timeline?.fps||30));
        const durationMs = Math.max(34,Math.floor(timeline?.totalDurationMs || 10000)-startMs),
          sourceMs = a?.durationMs || durationMs;
        const c = {
          id: "bg-" + crypto.randomUUID(),
          assetId: id,
          startMs,
          durationMs,
          enabled: true,
          seed: 7,
          ...autoSegment(sourceMs, durationMs, 7),
        };
        globalUpdate({
          backgroundTracks: [
            ...(draftRef.current.settings.backgroundTracks || []),
            c,
          ],
        });
        setSelectedClip(c.id);
      } else if (role === "MEME")
        update(target.itemId, {
          visual: {
            ...v,
            meme: {
              ...v.meme,
              assetId: id,
              enabled: true,
              startMs:localMs??v.meme.startMs,
              width: Math.round(
                Math.min(
                  v.meme.width,
                  a?.width && a.height ? (900 * a.width) / a.height : 1080,
                ),
              ),
              height: Math.round(
                a?.width && a.height
                  ? Math.min(900, (v.meme.width * a.height) / a.width)
                  : v.meme.height,
              ),
              lockAspect: true,
            },
          },
        });
      else if (role === "SFX")
        update(target.itemId, {
          visual: { ...v, sfx: { ...v.sfx, assetId: id, enabled: true,startMs:localMs??v.sfx.startMs } },
        });
      else
        globalUpdate({
          backgroundMusic: { ...defaultBgm(), assetId: id, enabled: true,startMs:atFrame===undefined?0:Math.floor(atFrame*1000/(timeline?.fps||30)) },
        });
      if(role==="MEME"||role==="SFX")setSelected(target.itemId);
      if(atFrame!==undefined)seek(atFrame);
      setObject(role);
    });
  };
  const save = () =>
    void action(async () => {
      const snapshot = structuredClone(draftRef.current);
      const saved: StudioSession = await api(base + "/editor", "PUT", {
        revision: loadedRevision.current,
        settings: snapshot.settings,
        displayEdits: snapshot.displayEdits,
      });
      saving.current = true;
      try {
        let job = await api(base + "/jobs", "POST", {
          operation: "editor/prepare",
          input: { revision: saved.revision },
        });
        while (["RUNNING", "QUEUED"].includes(job.status)) {
          await new Promise((r) => setTimeout(r, 400));
          job = await api("/api/studio/jobs/" + job.jobId);
        }
        if (!["SUCCEEDED", "WAITING_REVIEW"].includes(job.status))
          throw Error(
            job.error || "Preview preparation " + job.status.toLowerCase(),
          );
      } finally {
        const fresh = await api(base);
        loadedRevision.current = fresh.revision;
        const clean = { settings: editorSettings(fresh), displayEdits: {} };
        setDraft(clean);
        setBaseline(serialize(clean));
        setPast([]);
        setFuture([]);
        accept(fresh);
        saving.current = false;
      }
      setNotice("Saved locally · preview validated");
    });
  const undo = () => {
    if (!past.length) return;
    player.current?.pause();
    setFuture((rows) => [structuredClone(draft), ...rows]);
    setDraft(past[past.length - 1]);
    setPast((rows) => rows.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    player.current?.pause();
    setPast((rows) => [...rows, structuredClone(draft)]);
    setDraft(future[0]);
    setFuture((rows) => rows.slice(1));
  };
  const remove = (id: string) => {
    const d = structuredClone(draftRef.current);
    for (const x of d.settings.scenes) {
      x.mediaAssetIds = x.mediaAssetIds.filter((a) => a !== id);
      const v = normalizeVisual(x.visual);
      if (v.meme.assetId === id) {
        v.meme.assetId = null;
        v.meme.enabled = false;
      }
      if (v.sfx.assetId === id) {
        v.sfx.assetId = null;
        v.sfx.enabled = false;
      }
      if (v.backgroundId === id) v.backgroundId = null;
      x.visual = v;
    }
    d.settings.backgroundTracks = d.settings.backgroundTracks?.filter(
      (c) => c.assetId !== id,
    );
    if (d.settings.backgroundMusic?.assetId === id)
      d.settings.backgroundMusic = { ...defaultBgm() };
    if (d.settings.backgroundId === id) d.settings.backgroundId = null;
    change(d);
  };
  const canDelete = (id: string) =>
    !dirty &&
    !draft.settings.scenes.some(
      (s) =>
        s.mediaAssetIds.includes(id) ||
        s.visual?.meme.assetId === id ||
        s.visual?.backgroundId === id,
    ) &&
    draft.settings.backgroundId !== id &&
    !draft.settings.backgroundTracks?.some((c) => c.assetId === id) &&
    draft.settings.backgroundMusic?.assetId !== id &&
    !draft.settings.scenes.some((x) => x.visual?.sfx.assetId === id);
  const deleteUpload = (a: StudioMediaAsset) => {
    if (
      !window.confirm(
        "Delete this unused uploaded file permanently? Public/source/audio files are never removed.",
      )
    )
      return;
    void action(async () => {
      saving.current = true;
      accept(
        await api(base + "/media/" + a.id, "DELETE", {
          revision: session.revision,
          sha256: a.sha256,
          confirm: true,
        }),
      );
    });
  };
  const upload = (f: File, category: string) =>
    void action(async () => {
      if (dirty) throw Error("Save your edits before uploading.");
      const data = new FormData();
      data.append("file", f);
      data.append("category", category);
      data.append("revision", String(session.revision));
      data.append("requestId", crypto.randomUUID());
      const r = await fetch(base + "/media", { method: "POST", body: data });
      const j = await r.json();
      if (!r.ok) throw Error(j.error?.message || "Upload failed");
      let job = j.data;
      while (["QUEUED", "RUNNING"].includes(job.status)) {
        await new Promise((r) => setTimeout(r, 400));
        job = await api("/api/studio/jobs/" + job.jobId);
      }
      if (job.status === "FAILED") throw Error(job.error);
      saving.current = true;
      accept(await api(base));
    });
  const beginGesture = () => {
    if (player.current?.isPlaying()) return;
    gesture.current = structuredClone(draftRef.current);
  };
  const endGesture = () => {
    const before = gesture.current;
    if (before && serialize(before) !== serialize(draftRef.current)) {
      setPast((rows) => [...rows.slice(-29), before]);
      setFuture([]);
    }
    gesture.current = null;
  };
  const transientVisual = (visual: ReturnType<typeof normalizeVisual>) =>
    setDraft((d) => ({
      ...d,
      settings: {
        ...d.settings,
        scenes: d.settings.scenes.map((x) =>
          x.itemId === selected ? { ...x, visual } : x,
        ),
      },
    }));
  const editClip = (
    c: EditorClip,
    startFrame: number,
    endFrame: number,
    trim: boolean,
  ) => {
    if (!gesture.current || !timeline) return;
    const d = structuredClone(gesture.current),
      ms = (n: number) => Math.floor((n * 1000) / timeline.fps),
      startMs = ms(startFrame),
      durationMs = Math.max(34, ms(endFrame - startFrame)),
      delta = ms(startFrame - c.start),
      scene = timeline.scenes.find((x) => x.scene.id === c.sceneId),
      x = d.settings.scenes.find((x) => x.itemId === c.sceneId),
      v = x ? normalizeVisual(x.visual) : null;
    if (c.object === "BACKGROUND" && !c.sceneId) {
      d.settings.backgroundTracks = d.settings.backgroundTracks?.map((b) =>
        b.id === c.id
          ? {
              ...b,
              startMs,
              durationMs: Math.min(
                durationMs,
                b.loop
                  ? 86400000
                  : b.sourceOutMs -
                      b.sourceInMs -
                      (trim
                        ? Math.max(0, (b.offsetMs || 0) + delta)
                        : b.offsetMs || 0),
              ),
              offsetMs: trim
                ? Math.max(0, (b.offsetMs || 0) + delta) %
                  (b.sourceOutMs - b.sourceInMs)
                : b.offsetMs,
            }
          : b,
      );
    } else if (c.object === "BGM") {
      const b = d.settings.backgroundMusic || defaultBgm();
      d.settings.backgroundMusic = {
        ...b,
        startMs,
        durationMs,
        sourceInMs: trim
          ? shiftSourceInMs(b.sourceInMs||0,startFrame-c.start,timeline.fps)
          : b.sourceInMs,
      };
    } else if (x && v && scene) {
      const local = Math.max(0, startMs - ms(scene.startFrame));
      if (c.object === "MEME")
        v.meme = { ...v.meme, startMs: local, durationMs };
      else if (c.object === "CARD")
        v.card = { ...v.card, startMs: local, durationMs };
      else if (c.object === "SFX")
        v.sfx = {
          ...v.sfx,
          startMs: local,
          durationMs,
          sourceInMs: trim
            ? shiftSourceInMs(v.sfx.sourceInMs||0,startFrame-c.start,timeline.fps)
            : v.sfx.sourceInMs,
        };
      else if (c.object === "VOICE") {
        v.voiceStartMs = Math.max(
          0,
          startMs - ms(scene.audioStartFrame ?? scene.contentStartFrame),
        );
        v.voiceDurationMs = durationMs;
        v.voiceSourceInMs = trim
          ? shiftSourceInMs(v.voiceSourceInMs||0,startFrame-c.start,timeline.fps)
          : v.voiceSourceInMs;
      }
      x.visual = v;
    }
    setDraft(d);
  };
  const deleteClip = (c: EditorClip) => {
    if (blocked) return;
    if (c.sceneId) {
      const x = draftRef.current.settings.scenes.find(
        (x) => x.itemId === c.sceneId,
      );
      if (!x) return;
      const v = normalizeVisual(x.visual);
      if (c.object === "MEME")
        v.meme = { ...v.meme, enabled: false, assetId: null };
      else if (c.object === "SFX")
        v.sfx = { ...v.sfx, enabled: false, assetId: null };
      else if (c.object === "VOICE") v.voiceEnabled = false;
      else if (c.object === "CARD") v.card.enabled = false;
      else v.backgroundId = null;
      update(x.itemId, { visual: v });
    } else if (c.object === "BGM")
      globalUpdate({ backgroundMusic: defaultBgm() });
    else
      globalUpdate({
        backgroundTracks: draft.settings.backgroundTracks?.filter(
          (b) => b.id !== c.id,
        ),
      });
  };
  const selectClip = (c: EditorClip) => {
    setSelectedClip(c.id);
    if (c.sceneId) select(c.sceneId, c.object, false);
    else setObject(c.object);
    seek(c.start);
  };
  const recategorize = (id: string, category: string) =>
    void action(async () => {
      if (dirty) throw Error("Save edits first");
      saving.current = true;
      accept(
        await api(base + "/media/" + id + "/category", "PUT", {
          revision: session.revision,
          category,
        }),
      );
    });
  const width = Math.max(
    80,
    Math.min(stageSize.width - 48, ((stageSize.height - 32) * 9) / 16),
  );
  return (
    <section className="pro-editor" data-testid="professional-editor">
      <div className="editor-toolbar">
        <div>
          <strong>{session.title}</strong>
          <small>
            {session.id.slice(0, 8)} ·{" "}
            <span data-testid="save-state">
              {dirty ? "Unsaved changes" : "Saved locally"}
            </span>
          </small>
        </div>
        <div className="toolbar-buttons">
          <button
            aria-label="Undo"
            disabled={blocked || !past.length}
            onClick={undo}
          >
            ↶
          </button>
          <button
            aria-label="Redo"
            disabled={blocked || !future.length}
            onClick={redo}
          >
            ↷
          </button>
          <button
            disabled={!request || !!live.error}
            onClick={() =>
              player.current?.isPlaying()
                ? player.current.pause()
                : player.current?.play()
            }
          >
            ▶ Preview
          </button>
          <button
            className="primary"
            disabled={blocked || !dirty || !!live.error}
            onClick={save}
          >
            Save project
          </button>
          <select
            aria-label="Studio appearance"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            <option value="DARK">Studio: Dark</option>
            <option value="LIGHT">Studio: Light</option>
          </select>
        </div>
      </div>
      {(error || live.error || notice) && (
        <div
          className={"editor-message " + (error || live.error ? "error" : "")}
          role="status"
        >
          {error || live.error || notice}
        </div>
      )}
      <div className="editor-panels">
        <section className="editor-left">
          <div className="panel-tabs">
            <button
              className={tab === "SCENES" ? "active" : ""}
              onClick={() => setTab("SCENES")}
            >
              Scenes <small>{draft.settings.scenes.length}</small>
            </button>
            <button
              className={tab === "ASSETS" ? "active" : ""}
              onClick={() => setTab("ASSETS")}
            >
              Assets
            </button>
          </div>
          <div className="panel-scroll">
            {tab === "SCENES" ? (
              <div className="pro-scene-list">
                {draft.settings.scenes.map((s, n) => {
                  const i = session.items.find((i) => i.id === s.itemId)!;
                  const t = timeline?.scenes.find(
                    (t) => t.scene.id === s.itemId,
                  );
                  return (
                    <article
                      key={s.itemId}
                      data-item-id={s.itemId}
                      className={selected === s.itemId ? "selected-scene" : ""}
                    >
                      <button
                        onClick={() => select(s.itemId)}
                        className="scene-select"
                      >
                        <span className="scene-number">
                          {String(n + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <b>{i.author.displayName}</b>
                          <small>
                            {(draft.displayEdits[i.id] ?? i.displayText).slice(
                              0,
                              90,
                            )}
                          </small>
                        </div>
                      </button>
                      <div className="scene-row-controls">
                        <label>
                          <input
                            type="checkbox"
                            aria-label={"Enable " + i.author.displayName}
                            checked={s.enabled}
                            disabled={blocked}
                            onChange={(e) =>
                              update(s.itemId, { enabled: e.target.checked })
                            }
                          />{" "}
                          Enabled
                        </label>
                        <span>
                          {t
                            ? (
                                (t.endFrame - t.startFrame) /
                                timeline!.fps
                              ).toFixed(2) + "s"
                            : "Disabled"}
                        </span>
                        <button
                          aria-label="Move scene up"
                          disabled={blocked || n === 0}
                          onClick={() => {
                            const rows = [...draft.settings.scenes];
                            [rows[n - 1], rows[n]] = [rows[n], rows[n - 1]];
                            globalUpdate({ scenes: rows });
                          }}
                        >
                          ↑
                        </button>
                        <button
                          aria-label="Move scene down"
                          disabled={
                            blocked || n === draft.settings.scenes.length - 1
                          }
                          onClick={() => {
                            const rows = [...draft.settings.scenes];
                            [rows[n], rows[n + 1]] = [rows[n + 1], rows[n]];
                            globalUpdate({ scenes: rows });
                          }}
                        >
                          ↓
                        </button>
                      </div>
                      <small
                        className={t?.scene.audioAssetId ? "" : "missing-voice"}
                      >
                        {t?.scene.audioAssetId
                          ? project?.audioAssets.find(
                              (a) => a.id === t.scene.audioAssetId,
                            )?.approvalStatus === "APPROVED"
                            ? "Approved narration linked"
                            : "Narration linked · preview/DRAFT"
                          : "No voice · visual-only"}
                      </small>
                    </article>
                  );
                })}
              </div>
            ) : (
              <ContextAssets
                library={library}
                uploads={session.studioMedia || []}
                context={picker}
                category={category}
                setCategory={setCategory}
                busy={blocked}
                assign={assign}
                upload={upload}
                remove={remove}
                deleteUpload={deleteUpload}
                canDelete={canDelete}
                recategorize={recategorize}
                onAudition={() => player.current?.pause()}
              />
            )}
          </div>
        </section>
        <section className="editor-center">
          <div className="preview-heading">
            <span>SERIOUS / 9:16</span>
            <label>
              <input
                type="checkbox"
                checked={safe}
                onChange={(e) => setSafe(e.target.checked)}
              />{" "}
              Safe areas
            </label>
          </div>
          <div ref={stage} className="preview-stage">
            <div
              className="preview-surface"
              style={{ width, height: (width * 16) / 9 }}
              onClickCapture={(e) => {
                const o = (e.target as Element)
                  .closest("[data-editor-object]")
                  ?.getAttribute("data-editor-object") as
                  | EditorObject
                  | undefined;
                if (o) {
                  const sid =
                    (e.target as Element)
                      .closest("[data-scene-id]")
                      ?.getAttribute("data-scene-id") ||
                    active?.scene.id ||
                    selected;
                  select(sid, o, false);
                }
              }}
            >
              {request ? (
                <Player
                  ref={player}
                  component={SeriousTimelinePreview}
                  inputProps={request.inputProps}
                  durationInFrames={request.durationInFrames}
                  compositionWidth={1080}
                  compositionHeight={1920}
                  fps={request.fps}
                  controls
                  clickToPlay={false}
                  numberOfSharedAudioTags={6}
                  style={{ width: "100%", height: "100%" }}
                />
              ) : (
                <div className="preview-placeholder">
                  Enable a scene to preview
                </div>
              )}
              {current && item && (
                <CanvasTransform
                  object={object}
                  visual={normalizeVisual(current.visual)}
                  text={draft.displayEdits[item.id] ?? item.displayText}
                  sceneId={item.id}
                  frame={frame}
                  width={width}
                  playing={() => blocked || !!player.current?.isPlaying()}
                  start={beginGesture}
                  update={transientVisual}
                  finish={endGesture}
                />
              )}
              {safe && (
                <div className="safe-guidance">
                  <span>Approx. TikTok UI safe area</span>
                </div>
              )}
            </div>
          </div>
          <div className="preview-footer">
            <button
              disabled={!request}
              onClick={() =>
                player.current?.isPlaying()
                  ? player.current.pause()
                  : player.current?.play()
              }
            >
              Play / pause
            </button>
            <span data-testid="editor-frame">
              Frame {frame} / {timeline?.totalFrames ?? 0} ·{" "}
              {(frame / (timeline?.fps || 30)).toFixed(2)}s
            </span>
            <small>9:16 · 1080×1920 · {timeline?.fps ?? 30} FPS</small>
          </div>
        </section>
        <section className="editor-inspector">
          <div className="panel-title">PROPERTIES</div>
          <div className="object-tabs">
            {(
              [
                "CARD",
                "MEME",
                "BACKGROUND",
                "VOICE",
                "SFX",
                "BGM",
              ] as EditorObject[]
            ).map((o) => (
              <button
                key={o}
                className={object === o ? "active" : ""}
                onClick={() => setObject(o)}
              >
                {
                  {
                    CARD: "Card",
                    MEME: "Meme",
                    BACKGROUND: "BG",
                    VOICE: "Voice",
                    SFX: "SFX",
                    BGM: "BGM",
                  }[o]
                }
              </button>
            ))}
          </div>
          <div className="panel-scroll">
            {object === "BACKGROUND" ? (
              <GlobalBackgroundInspector
                disabled={blocked}
                clips={draft.settings.backgroundTracks || []}
                id={selectedClip}
                assets={[...library, ...(session.studioMedia || [])]}
                frameMs={Math.floor((frame * 1000) / (timeline?.fps || 30))}
                totalMs={Math.floor(timeline?.totalDurationMs || 10000)}
                update={(backgroundTracks) =>
                  globalUpdate({ backgroundTracks })
                }
                select={setSelectedClip}
                choose={() => choose("BACKGROUND")}
              />
            ) : (
              item &&
              current && (
                <EditorInspector
                  sceneDurationMs={
                    Math.floor(
                      ((timeline?.scenes.find((s) => s.scene.id === selected)
                        ?.durationInFrames ?? 0) *
                        1000) /
                        (timeline?.fps || 30),
                    ) || current.silentDurationMs
                  }
                  voiceDurationMs={
                    project?.audioAssets.find(
                      (a) =>
                        a.id ===
                        timeline?.scenes.find((s) => s.scene.id === selected)
                          ?.scene.audioAssetId,
                    )?.durationMs
                  }
                  sfxDurationMs={
                    project?.audioAssets.find(
                      (a) => a.id === current.visual?.sfx.assetId,
                    )?.durationMs
                  }
                  timelineDurationMs={Math.floor(
                    timeline?.totalDurationMs || 0,
                  )}
                  object={object}
                  item={item}
                  current={current}
                  settings={draft.settings}
                  disabled={blocked}
                  update={(p) => update(selected, p)}
                  globalUpdate={globalUpdate}
                  choose={choose}
                  text={draft.displayEdits[item.id] ?? item.displayText}
                  editText={(value) =>
                    change({
                      ...draft,
                      displayEdits: { ...draft.displayEdits, [item.id]: value },
                    })
                  }
                  onVoice={() => {
                    if (
                      !dirty ||
                      window.confirm("Leave without saving editor changes?")
                    )
                      onNavigate?.("Voice");
                  }}
                />
              )
            )}
          </div>
        </section>
      </div>
      <EditableTimeline
        project={project}
        clips={clips}
        frame={frame}
        playing={() => blocked || !!player.current?.isPlaying()}
        seek={seek}
        select={selectClip}
        start={beginGesture}
        move={editClip}
        finish={endGesture}
        remove={deleteClip}
        drop={assign}
      />
    </section>
  );
}
