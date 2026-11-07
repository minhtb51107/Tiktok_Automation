import {studioRequest} from './integration-api';
import {RuntimeSafetyBanner} from './RuntimeSafety';
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  StudioSession,
  StudioItem,
} from "../../../1_nest_backend/src/studio/studio.contracts";
import type { VideoPreviewProps } from "../../../1_nest_backend/src/video-pipeline/contracts";
import type { StudioJob } from "../../../1_nest_backend/src/studio/progress";
import type { RenderManifest } from "../../../1_nest_backend/src/studio/render.types";
import type { LibraryAsset } from "../../../1_nest_backend/src/studio/public-assets";
import "./studio.css";
import { ScriptWorkspace } from "./ScriptWorkspace";
import { VoiceWorkspace } from "./VoiceWorkspace";
import { ProgressPanel } from "./ProgressPanel";
import { EditorWorkspace } from "./EditorWorkspace";

import { PublishingWorkspace } from "./PublishingWorkspace";
import { RenderWorkspace } from "./RenderWorkspace";
import { DashboardWorkspace } from "./DashboardWorkspace";
import {ContentLibraryWorkspace} from "./ContentLibraryWorkspace";
import {CollectionWorkspace} from "./CollectionWorkspace";
import {ProjectList} from "./ProjectList";
import {studioRoute} from "../../../1_nest_backend/src/studio/studio-navigation";
import "./uiops02.css";
import { DiscoveryWorkspace } from "./DiscoveryWorkspace";
import {
  ProductionQueueWorkspace,
  SettingsWorkspace,
} from "./OperationsWorkspaces";
import {
  catalogPendingReview,
  fetchData01Catalog,
  catalogProvenance,
  type Data01CatalogResponse,
} from "./studio-v2-adapter";

export type StudioPreviewInput = VideoPreviewProps;

const WORKFLOW_STEPS = [
  "Source",
  "Script",
  "Voice",
  "Video Editor",
  "Render",
  "Publish",
] as const;

const STEP_LABELS: Record<(typeof WORKFLOW_STEPS)[number], string> = {
  Source: "Nguồn bài",
  Script: "Kịch bản",
  Voice: "Giọng đọc",
  "Video Editor": "Bàn dựng 9:16",
  Render: "MP4 Output",
  Publish: "Review",
};

const STUDIO_AREAS = [
  "Dashboard",
  "Discovery",
  "Data Review",
  "Production Queue",
  "Video Studio",
  "Settings",
] as const;
export type StudioArea = (typeof STUDIO_AREAS)[number];

type AreaSlug =
  | "dashboard"
  | "discovery"
  | "data-review"
  | "production-queue"
  | "video-studio"
  | "settings";

const SLUG_TO_AREA: Record<AreaSlug, StudioArea> = {
  dashboard: "Dashboard",
  discovery: "Discovery",
  "data-review": "Data Review",
  "production-queue": "Production Queue",
  "video-studio": "Video Studio",
  settings: "Settings",
};

async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const match = url.match(/^\/([a-f0-9-]{36})\/(.+)$/);
  if (
    method === "POST" &&
    match &&
    /^(fetch|voice-runtime|voice-batch|voice\/[^/]+|metadata\/[^/]+|script\/[^/]+\/propose|script\/propose-offline-all|editor\/prepare)$/.test(
      match[2],
    )
  ) {
    const started = await fetch(`/api/studio/sessions/${match[1]}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: match[2], input: body || {} }),
    });
    const envelope = await started.json();
    if (!started.ok)
      throw Error(envelope.error?.message || "Could not start job");
    let job = envelope.data ?? envelope;
    while (["QUEUED", "RUNNING"].includes(job.status)) {
      await new Promise((r) => setTimeout(r, 1000));
      const r = await fetch(`/api/studio/jobs/${job.jobId}`);
      if (!r.ok) throw Error("Progress polling failed; refresh to recover job");
      const j = await r.json();
      job = j.data ?? j;
    }
    const result = await fetch(`/api/studio/sessions/${match[1]}`);
    const j = await result.json();
    if (job.status === "FAILED")
      window.dispatchEvent(
        new CustomEvent("studio-job-error", {
          detail: job.error || "Job failed; open the progress report.",
        }),
      );
    return (j.data ?? j) as T;
  }
  const r = await fetch("/api/studio/sessions" + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  if (!r.ok)
    throw new Error(
      Array.isArray(json.message)
        ? json.message.join(", ")
        : json.message || json.error?.message || "Request failed",
    );
  return json.data ?? json;
}

function AreaIcon({ area }: { area: StudioArea }) {
  switch (area) {
    case "Dashboard":
      return (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect
            x="2.5"
            y="2.5"
            width="6.5"
            height="6.5"
            rx="2"
            fill="currentColor"
          />
          <rect
            x="11"
            y="2.5"
            width="6.5"
            height="6.5"
            rx="2"
            fill="currentColor"
            fillOpacity="0.45"
          />
          <rect
            x="2.5"
            y="11"
            width="6.5"
            height="6.5"
            rx="2"
            fill="currentColor"
            fillOpacity="0.45"
          />
          <rect
            x="11"
            y="11"
            width="6.5"
            height="6.5"
            rx="2"
            fill="currentColor"
          />
        </svg>
      );
    case "Discovery":
      return (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle
            cx="9.5"
            cy="9.5"
            r="6"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M14 14L17.5 17.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "Data Review":
      return (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M4 5.5H16M4 10H16M4 14.5H11"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="15" cy="14.5" r="2.5" fill="currentColor" />
        </svg>
      );
    case "Production Queue":
      return (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect
            x="3"
            y="3"
            width="14"
            height="14"
            rx="3.5"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path d="M8.5 7.2L13.2 10L8.5 12.8V7.2Z" fill="currentColor" />
        </svg>
      );
    case "Video Studio":
      return (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect
            x="5"
            y="2.2"
            width="10"
            height="15.6"
            rx="2.5"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <circle cx="10" cy="14.5" r="1" fill="currentColor" />
        </svg>
      );
    case "Settings":
      return (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle
            cx="10"
            cy="10"
            r="3"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M10 2.5V4.5M10 15.5V17.5M2.5 10H4.5M15.5 10H17.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}

function App() {
  const [sessions, setSessions] = useState<
      { id: string; title: string; updatedAt?: string }[]
    >([]),
    [session, setSession] = useState<StudioSession | null>(null);
  const [step, setStep] = useState("Source"),
    [area, setArea] = useState<StudioArea>("Dashboard"),
    [localBusy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false);
  const [jobActive, setJobActive] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [theme, setTheme] = useState<"DARK" | "LIGHT">(
    () =>
      (localStorage.getItem("studio-appearance") as "DARK" | "LIGHT") || "DARK",
  );
  const [sessionJobs, setSessionJobs] = useState<StudioJob[]>([]);
  const [sessionRenders, setSessionRenders] = useState<RenderManifest[]>([]);
  const [publicAssets, setPublicAssets] = useState<LibraryAsset[]>([]);
  const [data01Catalog, setData01Catalog] =
    useState<Data01CatalogResponse | null>(null);
  const [data01Connected, setData01Connected] = useState<boolean>(false);
  const [projectPicker,setProjectPicker]=useState(true);const [routeReady,setRouteReady]=useState(false);

  useEffect(() => {
    document.documentElement.dataset.studioTheme = theme;
    localStorage.setItem("studio-appearance", theme);
  }, [theme]);

  useEffect(() => {
    if(!routeReady)return;const u=new URL(window.location.href);const projectRoute=area==='Video Studio'&&!projectPicker;
    if(projectRoute&&session)u.searchParams.set('session',session.id);else u.searchParams.delete('session');
    u.searchParams.set('area',area);u.searchParams.set('step',projectRoute?step:'Source');if(projectPicker&&area==='Video Studio')u.searchParams.set('view','projects');else u.searchParams.delete('view');
    window.history.replaceState(null,'',u.pathname+u.search);
  },[session?.id,step,area,projectPicker,routeReady]);

  const busy = localBusy || jobActive;

  const refresh = async () => {
    const list = await api<{ id: string; title: string; updatedAt?: string }[]>(
      "",
    );
    setSessions(list);
    return list;
  };

  const [dataPage,setDataPage]=useState(0);
  const refreshData01 = async (page=dataPage) => {
    const res = await fetchData01Catalog(page);
    setDataPage(page);
    setData01Connected(res.connected);
    setData01Catalog(res.catalog);
  };

  useEffect(()=>{const changed=()=>void refreshData01(0);window.addEventListener('studio-catalog-changed',changed);return()=>window.removeEventListener('studio-catalog-changed',changed)},[]);
  useEffect(() => {
    void refreshData01();
    fetch("/api/studio/public-assets")
      .then((r) => r.json())
      .then((j) => setPublicAssets(j.data ?? j ?? []))
      .catch(() => {});

    const route=studioRoute(window.location.search);setArea(route.area as StudioArea);setStep(route.step);setProjectPicker(route.picker);
    void refresh().then(()=>{if(!route.projectId)return;return api<StudioSession>('/'+route.projectId).then(s=>{setSession(s);if(route.area==='Video Studio')setProjectPicker(route.picker);});}).catch(e=>{setError('Project could not be opened: '+e.message);setProjectPicker(true);setArea('Video Studio');}).finally(()=>setRouteReady(true));

    const failed = (e: Event) => setError((e as CustomEvent<string>).detail);
    window.addEventListener("studio-job-error", failed);
    return () => window.removeEventListener("studio-job-error", failed);
  }, []);

  useEffect(() => {
    if (!session?.id) {
      setSessionJobs([]);
      setSessionRenders([]);
      return;
    }
    let alive = true;
    const loadTelemetry = async () => {
      try {
        const [jRes, rRes] = await Promise.all([
          fetch(`/api/studio/sessions/${session.id}/jobs`),
          fetch(`/api/studio/sessions/${session.id}/render`),
        ]);
        if (jRes.ok && alive) {
          const j = await jRes.json();
          setSessionJobs(j.data ?? j ?? []);
        }
        if (rRes.ok && alive) {
          const r = await rRes.json();
          const data = r.data ?? r;
          setSessionRenders(data?.renders ?? []);
        }
      } catch {}
    };
    void loadTelemetry();
  }, [session?.id, session?.revision, jobActive]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || editorDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, editorDirty]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const accept = (s: StudioSession) => {
    const u = new URL(window.location.href);
    u.searchParams.set("session", s.id);
    window.history.replaceState(null, "", u.pathname + u.search);
    setSession(s);
    setDirty(false);
  };
  const canLeave = () =>
    !(dirty || editorDirty) || window.confirm("Discard unsaved edits?");
  const save = async () => {
    if (!session) return;
    accept(
      await api("/" + session.id, "PUT", {
        revision: session.revision,
        title: session.title,
        items: session.items.map(
          ({ id, selected, displayText, spokenText, metadata }) => ({
            id,
            selected,
            displayText,
            spokenText,
            metadata,
          }),
        ),
      }),
    );
    await refresh();
    setNotice("Đã lưu dự án cục bộ.");
  };
  const update = (id: string, patch: Partial<StudioItem>) => {
    if (!session) return;
    setSession({
      ...session,
      items: session.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    });
    setDirty(true);
  };
  const move = (id: string, direction: number) => {
    if (!session) return;
    const items = [...session.items],
      at = items.findIndex((i) => i.id === id),
      to = at + direction;
    if (to < 0 || to >= items.length) return;
    [items[at], items[to]] = [items[to], items[at]];
    setSession({
      ...session,
      items: items.map((i, order) => ({ ...i, order })),
    });
    setDirty(true);
  };

  const navigateStep=(next:string)=>{if(!canLeave())return;setArea('Video Studio');if(!session){setProjectPicker(true);setNotice('Choose a project first.');return;}setProjectPicker(false);setStep(next);};
  const navigateArea=(next:StudioArea)=>{if(!canLeave())return;setArea(next);if(next==='Video Studio'){setProjectPicker(true);setStep('Source');}else if(next==='Discovery'||next==='Production Queue')setStep('Source');};
  const navigateAreaBySlug=(slug:AreaSlug)=>navigateArea(SLUG_TO_AREA[slug]);
  const openProject=(id:string)=>{if(!canLeave())return;void run(async()=>{accept(await api('/'+id));setArea('Video Studio');setProjectPicker(false);setStep('Source');});};
  const createProject=()=>{if(!canLeave())return;void run(async()=>{accept(await api('','POST'));await refresh();setArea('Video Studio');setProjectPicker(false);setStep('Source');});};
  const isEditorFull=area==='Video Studio'&&!projectPicker&&step==='Video Editor'&&session!==null;
  const showContextualStepBar=area==='Video Studio'&&!projectPicker&&session!==null;

  const completedRendersCount = sessionRenders.filter(
    (r) => r.status === "COMPLETED",
  ).length;

  const AREA_LABELS: Record<
    StudioArea,
    { title: string; badge: string | number }
  > = {
    Dashboard: { title: "Tổng quan Studio", badge: "Home" },
    Discovery: {
      title: "Discovery / Data Collection",
      badge: "Manual",
    },
    "Data Review": {
      title: "Content Library / Data Review",
      badge: `${catalogPendingReview(data01Catalog)} chờ`,
    },
    "Production Queue": {
      title: "Kho Video & Hàng đợi",
      badge: `${completedRendersCount} MP4`,
    },
    "Video Studio": { title: "Video Projects", badge: sessions.length },
    Settings: { title: "Settings", badge: "Runtime" },
  };

  return (
    <div
      className={
        "studio shell " +
        (isEditorFull ? "is-editor " : "") +
        (theme === "DARK" ? "is-dark" : "is-light")
      }
    >
      <aside className="v3-sidebar">
        {/* Studio Brand Identity */}
        <a className="v3-brand" href="/studio">
          <span className="v3-brand-prism" aria-hidden="true">
            <svg viewBox="0 0 28 28" fill="none">
              <defs>
                <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#a78bfa" />
                  <stop offset="50%" stopColor="#f472b6" />
                  <stop offset="100%" stopColor="#fde047" />
                </linearGradient>
              </defs>
              <rect
                x="2"
                y="2"
                width="24"
                height="24"
                rx="8"
                fill="url(#brandGrad)"
              />
              <path
                d="M11 9.5L19 14L11 18.5V9.5Z"
                fill="#121218"
              />
            </svg>
          </span>
          <div className="v3-brand-text">
            <strong>Threads Studio</strong>
            <small>Creative Operations</small>
          </div>
        </a>

        {/* Primary Task Navigation (Zero Legacy Clutter) */}
        <div className="v3-nav-section">
          <div className="eyebrow">KHÔNG GIAN LÀM VIỆC</div>
          <div
            className="v2-area-nav"
            role="navigation"
            aria-label="Điều hướng chính"
          >
            {STUDIO_AREAS.filter(a=>a!=="Production Queue").map((a) => (
              <button
                key={a}
                data-area={a}
                className={"v2-area-btn " + ((area===a||(a==="Video Studio"&&area==="Production Queue"))?"active":"")}
                onClick={() => navigateArea(a)}
              >
                <span className="v3-nav-item-left">
                  <AreaIcon area={a} />
                  <span>{AREA_LABELS[a].title}</span>
                </span>
                <small>{AREA_LABELS[a].badge}</small>
              </button>
            ))}
          </div>
        </div>

        {session&&<div className="v2-card"><small>Current project (not catalog scope)</small><strong>{session.title}</strong><button onClick={()=>navigateArea('Video Studio')}>Choose another project</button></div>}

        {/* Bottom Dock: Theme Switcher Pill + Dashed New Project Card (Inspired by Reference 2) */}
        <div className="v3-sidebar-dock">
          <button
            type="button"
            className="v3-new-project-card"
            aria-label="New project"
            disabled={busy}
            onClick={createProject}
          >
            <span className="v3-plus-circle">＋</span>
            <strong>Tạo dự án Threads mới</strong>
            <small>Bắt đầu từ liên kết bài viết</small>
          </button>
        </div>
      </aside>

      <main>
        <header className="v2-topbar v3-topbar">
          <div className="v3-topbar-title-group">
            <div className="v3-breadcrumb">
              <span className="v3-live-dot" />
              <span>Threads Studio</span>
              <span>/</span>
              <button className="uiops-breadcrumb" onClick={()=>navigateArea('Video Studio')}>Video Projects</button><strong>{showContextualStepBar?session?.title+' → '+STEP_LABELS[step as keyof typeof STEP_LABELS]:AREA_LABELS[area].title}</strong>
            </div>
            {!isEditorFull&&<h1>{showContextualStepBar?session?.title:AREA_LABELS[area].title}</h1>}
          </div>
          <div className="v2-topbar-controls">
            <RuntimeSafetyBanner/>
            <span
              className={`v3-prov-pill ${
                data01Connected ? "prov-real" : "prov-disconnected"
              }`}
              title={
                data01Connected
                  ? "Đã kết nối trực tiếp với động cơ dữ liệu DATA-01"
                  : "Chưa kết nối API DATA-01"
              }
            >
              {data01Connected ? `● DATA-01: ${catalogProvenance(data01Catalog)}` : "○ DATA-01: NOT CONNECTED"}
            </span>
            <span className="badge v3-session-badge">
              Phiên cục bộ{" "}
              {session && (
                <small data-testid="active-session">
                  {session.id.slice(0, 8)} · rev {session.revision}
                </small>
              )}
            </span>
            <button
              type="button"
              className="v2-theme-toggle"
              data-testid="global-theme" aria-label="Toggle Light or Dark theme"
              onClick={() => setTheme(theme === "DARK" ? "LIGHT" : "DARK")}
            >
              {theme === "DARK" ? "☀ Light" : "☾ Dark"}
            </button>
          </div>
        </header>

        {/* Contextual Workflow Bar: Shown ONLY in Discovery / Studio steps, never duplicated on Dashboard */}
        {showContextualStepBar && (
          <nav className="v3-contextual-steps" aria-label="Các bước dựng chi tiết">
            {WORKFLOW_STEPS.map((name, n) => (
              <button
                className={step === name ? "current" : ""}
                onClick={() => navigateStep(name)}
                key={name} data-step={name}
              >
                <b>{n + 1}</b>
                <span>{STEP_LABELS[name]}</span>
              </button>
            ))}
          </nav>
        )}

        {error && (
          <div role="alert" className="alert error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="alert">
            {notice}
          </div>
        )}
        {busy && (
          <div role="status" className="alert">
            Đang xử lý. Tác vụ có Job ID vẫn tiếp tục và xem lại được sau
            refresh.
          </div>
        )}

        {/* Progress Drawer: Shown when a job is actively running or inside manual production steps */}
        {session && (jobActive || showContextualStepBar) && (
          <details
            className={
              isEditorFull ? "editor-jobs" : "v2-jobs-drawer render-shared-jobs"
            }
            open={jobActive}
          >
            <summary>
              <span>
                Tiến trình tác vụ ({sessionJobs.length}){" "}
                {jobActive ? "· ĐANG CHẠY" : "· Sẵn sàng"}
              </span>
            </summary>
            <ProgressPanel
              id={session.id}
              onActive={setJobActive}
              onCompleted={() => {
                if (!dirty && !editorDirty)
                  void api<StudioSession>("/" + session.id)
                    .then(accept)
                    .catch((e) => setError(e.message));
              }}
            />
          </details>
        )}

        {/* Primary Area Router */}
        {area==='Video Studio'&&(projectPicker||!session)?<ProjectList projects={sessions} busy={busy} onOpen={openProject} onCreate={createProject} onQueue={()=>navigateArea('Production Queue')}/>:area === "Dashboard" ? (
          <DashboardWorkspace
            sessionsCount={sessions.length}
            session={session}
            jobs={sessionJobs}
            renders={sessionRenders}
            data01Catalog={data01Catalog}
            data01Connected={data01Connected}
            onNavigateArea={navigateAreaBySlug}
            onNavigateStep={navigateStep}
          />
        ) : area === "Data Review" ? (
          <ContentLibraryWorkspace/>
        ) : area==='Discovery'?(
          <CollectionWorkspace onReview={()=>navigateArea('Data Review')}/>
        ) : area === "Settings" ? (
          <SettingsWorkspace
            session={session}
            publicAssets={publicAssets}
            theme={theme}
            busy={busy}
            onCheckVoiceRuntime={() => {
              if (!session) return;
              void run(async () => {
                accept(await api("/" + session.id + "/voice-runtime", "POST"));
              });
            }}
          />
        ) : area === "Production Queue" &&
          !["Render", "Publish"].includes(step) ? (
          <ProductionQueueWorkspace
            session={session}
            jobs={sessionJobs}
            renders={sessionRenders}
            busy={busy}
            onCancelJob={(jobId) => {
              void fetch(`/api/studio/jobs/${jobId}/cancel`, {
                method: "POST",
              }).then(() => setNotice("Đã gửi yêu cầu hủy tác vụ."));
            }}
            onOpenStep={navigateStep}
            onOpenProject={async(project,step)=>{if(!canLeave())return;const s=await api<StudioSession>("/"+project);accept(s);await refresh();setStep(step);setProjectPicker(false);setArea("Video Studio");}}
          />
        ) : step === "Script" && session ? (
          <ScriptWorkspace
            onSession={accept}
            approveEditorial={(revision,reason)=>void run(async()=>accept(await studioRequest<StudioSession>('/data/editorial/sessions/'+session!.id+'/approve-script',{revision,confirmUserReview:true,reason})))}
            session={session}
            busy={busy}
            dirty={dirty}
            edit={update}
            save={() => void run(save)}
            propose={(itemId, mode = "LIVE") =>
              void run(async () => {
                accept(
                  await api(
                    "/" + session.id + "/script/" + itemId + "/propose",
                    "POST",
                    { revision: session.revision, mode },
                  ),
                );
              })
            }
            proposeAll={() =>
              void run(async () => {
                accept(
                  await api(
                    "/" + session.id + "/script/propose-offline-all",
                    "POST",
                    { revision: session.revision },
                  ),
                );
              })
            }
            decide={(runId, action) =>
              void run(async () => {
                accept(
                  await api("/" + session.id + "/script/decision", "POST", {
                    revision: session.revision,
                    runId,
                    action,
                  }),
                );
              })
            }
          />
        ) : step === "Voice" && session ? (
          <VoiceWorkspace
            session={session}
            busy={busy}
            dirty={dirty}
            check={() =>
              void run(async () => {
                accept(await api("/" + session.id + "/voice-runtime", "POST"));
              })
            }
            act={async (itemId, body) => {
              await run(async () => {
                accept(
                  await api("/" + session.id + "/voice/" + itemId, "POST", {
                    ...body,
                    revision: session.revision,
                  }),
                );
              });
            }}
            batch={async (body) => {
              await run(async () => {
                accept(
                  await api("/" + session.id + "/voice-batch", "POST", {
                    ...body,
                    revision: session.revision,
                  }),
                );
              });
            }}
          />
        ) : step === "Video Editor" && session ? (
          <EditorWorkspace
            data01Catalog={data01Catalog}
            onNavigate={navigateStep}
            onDirty={setEditorDirty}
            session={session}
            busy={busy || dirty}
            accept={accept}
            prepare={async () => {
              accept(
                await api("/" + session.id + "/editor/prepare", "POST", {
                  revision: session.revision,
                }),
              );
            }}
          />
        ) : step === "Render" && session ? (
          <RenderWorkspace
            session={session}
            busy={busy || dirty || editorDirty}
          />
        ) : step === "Publish" && session ? (
          <PublishingWorkspace
            key={session.id}
            session={session}
            busy={busy || dirty || editorDirty}
            onSession={accept}
          />
        ) : step !== "Source" ? (
          <section className="empty">
            <span className="hero-icon">◇</span>
            <h2>{step} workspace</h2>
            <p>
              This step is planned. Source selection and editing are available
              now.
            </p>
            <button onClick={() => setStep("Source")}>Return to Source</button>
          </section>
        ) : (
          <DiscoveryWorkspace projectSourceOnly
            session={session}
            busy={busy}
            dirty={dirty}
            onUpdateSessionTitle={(title) => {
              if (!session) return;
              setSession({ ...session, title });
              setDirty(true);
            }}
            onSave={() => void run(save)}
            onFetchUrls={async (urls, scope) => {
              if (!session) return;
              await run(async () => {
                const current = await api<StudioSession>("/" + session.id);
                accept(
                  await api("/" + session.id + "/fetch", "POST", {
                    revision: current.revision,
                    urls,
                    scope,
                  }),
                );
                await refresh();
              });
            }}
            onManualImport={async ({ text, author, comments, url }) => {
              if (!session) return;
              await run(async () => {
                accept(
                  await api("/" + session.id, "PUT", {
                    revision: session.revision,
                    manual: { text, author, comments, url },
                  }),
                );
                await refresh();
                setNotice("Đã nhập bài viết thủ công.");
              });
            }}
            onAddContextCandidate={async (originalUrl, index) => {
              if (!session) return;
              await run(async () => {
                accept(
                  await api("/" + session.id, "PUT", {
                    revision: session.revision,
                    addContext: {
                      originalUrl,
                      index,
                    },
                  }),
                );
              });
            }}
            onRefreshMetadata={(itemId) => {
              if (!session) return;
              void run(async () => {
                accept(
                  await api(
                    "/" + session.id + "/metadata/" + itemId,
                    "POST",
                    { revision: session.revision },
                  ),
                );
              });
            }}
            onSaveTopic={async (itemId, body) => {
              if (!session) return;
              await run(async () => {
                accept(
                  await api(
                    "/" + session.id + "/topic/" + itemId,
                    "POST",
                    { ...(body as object), revision: session.revision },
                  ),
                );
              });
            }}
            onUpdateItem={update}
            onMoveItem={move}
            onNavigateArea={navigateAreaBySlug}
            onRefreshData01={refreshData01}
            onCreateProject={() =>
              void run(async () => {
                accept(await api("", "POST"));
                await refresh();
              })
            }
          />
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
