import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  StudioSession,
  StudioItem,
} from "../../../1_nest_backend/src/studio/studio.contracts";
import type { VideoPreviewProps } from "../../../1_nest_backend/src/video-pipeline/contracts";
import "./studio.css";
import { UrlRows, MetadataEditor, MediaPreview } from "./SourceReview";
import { StageReportPanel } from "./StageReportPanel";
import { ThreadsPreview } from "./ThreadsPreview";
import { ScriptWorkspace } from "./ScriptWorkspace";
import { VoiceWorkspace } from "./VoiceWorkspace";
import { ProgressPanel } from "./ProgressPanel";
import { EditorWorkspace } from "./EditorWorkspace";
import {DataWorkspace} from "./DataWorkspace";
import {PublishingWorkspace} from "./PublishingWorkspace";
import { RenderWorkspace } from "./RenderWorkspace";

// Future editor passes this boundary to the existing SeriousTimelinePreview + Player.
export type StudioPreviewInput = VideoPreviewProps;
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
    // Stage errors remain visible in the session and persisted job report.
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
function App() {
  const [sessions, setSessions] = useState<{ id: string; title: string }[]>([]),
    [session, setSession] = useState<StudioSession | null>(null);
  const [step, setStep] = useState("Source"),
    [localBusy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false);
  const [jobActive, setJobActive] = useState(false);
  const [editorDirty,setEditorDirty]=useState(false);
  useEffect(()=>{if(!session)return;const u=new URL(window.location.href);u.searchParams.set('session',session.id);u.searchParams.set('step',step);window.history.replaceState(null,'',u.pathname+u.search);},[session?.id,step]);
  const busy = localBusy || jobActive;
  const [manual, setManual] = useState(false),
    [manualUrl, setManualUrl] = useState(""),
    [text, setText] = useState(""),
    [comments, setComments] = useState(""),
    [author, setAuthor] = useState("");
  const refresh = async () => setSessions(await api(""));
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const query=new URLSearchParams(window.location.search),id=query.get('session');
    if(id&&/^[a-f0-9-]{36}$/.test(id))void api<StudioSession>('/'+id).then(s=>{setSession(s);const requested=query.get('step');if(['Source','Script','Voice','Video Editor','Render','Publish','Data'].includes(requested||''))setStep(requested!);}).catch(e=>setError(e.message));
    const failed = (e: Event) => setError((e as CustomEvent<string>).detail);
    window.addEventListener("studio-job-error", failed);
    return () => window.removeEventListener("studio-job-error", failed);
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || editorDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty,editorDirty]);
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
    const u=new URL(window.location.href);u.searchParams.set('session',s.id);window.history.replaceState(null,'',u.pathname+u.search);
    setSession(s);
    setDirty(false);
  };
  const canLeave = () => !(dirty||editorDirty) || window.confirm("Discard unsaved edits?");
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
    setNotice("Project saved locally.");
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
  return (
    <div className={'studio '+(step==='Video Editor'&&session?'is-editor':'')}>
      <aside>
        <a className="brand" href="/studio">
          <span>◈</span> Content Studio
        </a>
        <div className="eyebrow">WORKFLOWS</div>
        <button className="workflow active">
          ◉ Threads SERIOUS <small>01</small>
        </button>
        {["FUNNY", "COMPILATION", "LYRICS"].map((w) => (
          <button className="workflow" disabled key={w}>
            {w}
            <small>Soon</small>
          </button>
        ))}
        <div className="project-heading">
          <span className="eyebrow">YOUR PROJECTS</span>
          <button
            aria-label="New project"
            disabled={busy}
            onClick={() => {
              if (canLeave())
                void run(async () => {
                  accept(await api("", "POST"));
                  await refresh();
                  setStep("Source");
                });
            }}
          >
            ＋
          </button>
        </div>
        <div className="sessions">
          {sessions.map((s) => (
            <button
              className={session?.id === s.id ? "chosen" : ""}
              key={s.id}
              disabled={busy}
              onClick={() => {
                if (canLeave())
                  void run(async () => {
                    accept(await api("/" + s.id));
                    setStep("Source");
                  });
              }}
            >
              {s.title}
              <small>SERIOUS · {s.id.slice(0,8)}</small>
            </button>
          ))}
        </div>
        <footer>
          LOCAL WORKSPACE
          <br />
          <span>Publishing automation is off</span>
        </footer>
      </aside>
      <main>
        <header>
          <div>
            <div className="eyebrow">THREADS / SERIOUS</div>
            <h1>{session?.title || "Your next story starts here"}</h1>
          </div>
          <span className="badge">● Local studio {session&&<small data-testid="active-session">Session {session.id} · revision {session.revision}</small>}</span>
        </header>
        <nav aria-label="Workflow steps"><button disabled={!session} title="Select a SERIOUS project to open Data Library" className={step==='Data'?'current':''} onClick={()=>{if(canLeave())setStep('Data');}}>Data Library</button>
          {[
            "Source",
            "Script",
            "Voice",
            "Video Editor",
            "Render",
            "Publish",
          ].map((name, n) => (
            <button
              className={step === name ? "current" : ""}
              onClick={() => {if(name===step||canLeave())setStep(name);}}
              key={name}
            >
              <b>{n + 1}</b>
              {name}
            </button>
          ))}
        </nav>
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
        {session && step!=='Data' && (['Video Editor','Render'].includes(step)?<details className={step==='Video Editor'?'editor-jobs':'render-shared-jobs'}><summary>All stage jobs</summary><ProgressPanel id={session.id} onActive={setJobActive} onCompleted={()=>{if(!dirty&&!editorDirty)void api<StudioSession>('/'+session.id).then(accept).catch(e=>setError(e.message));}}/></details>:(
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
        ))}
        {step === "Data" && session ? (<DataWorkspace key={session.id} session={session}/>) : step === "Script" && session ? (
          <ScriptWorkspace
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
            onNavigate={setStep}
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
          <RenderWorkspace session={session} busy={busy || dirty || editorDirty}/>
        ) : step === "Publish" && session ? (<PublishingWorkspace key={session.id} session={session} busy={busy||dirty||editorDirty} onSession={accept}/>) : step !== "Source" ? (
          <section className="empty">
            <span className="hero-icon">◇</span>
            <h2>{step} workspace</h2>
            <p>
              This step is planned. Source selection and editing are available
              now.
            </p>
            <button onClick={() => setStep("Source")}>Return to Source</button>
          </section>
        ) : !session ? (
          <section className="empty">
            <span className="hero-icon">✦</span>
            <h2>Turn a conversation into a thoughtful story.</h2>
            <p>
              Create a project, collect your source material, and choose what
              deserves a voice.
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  accept(await api("", "POST"));
                  await refresh();
                })
              }
            >
              ＋ Create SERIOUS project
            </button>
          </section>
        ) : (
          <>
            <section className="source-header">
              <div>
                <h2>01 / Source material</h2>
                <p>Collect the original. Shape your version. Keep both.</p>
              </div>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void run(save)}
              >
                {dirty ? "Save changes" : "Save project"}
              </button>
            </section>
            <label className="title-field">
              Project name
              <input
                maxLength={150}
                value={session.title}
                onChange={(e) => {
                  setSession({ ...session, title: e.target.value });
                  setDirty(true);
                }}
              />
            </label>
            <section className="panel">
              <div className="panel-top">
                <h3>Add Threads content</h3>
                <span>Up to 5 public URLs</span>
              </div>
              <UrlRows
                key={session.id}
                session={session}
                disabled={busy || dirty}
                onFetch={async (urls, scope) => {
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
              />
              <div className="actions">
                <button onClick={() => setManual(!manual)}>
                  {manual ? "Close manual import" : "Paste content manually"}
                </button>
                <small>
                  {dirty
                    ? "Save changes before importing."
                    : "Extraction runs only when you click Fetch."}
                </small>
              </div>
              {manual && (
                <div className="manual">
                  <h3>Manual source import</h3>
                  <label>
                    Original source URL (optional)
                    <input
                      value={manualUrl}
                      onChange={(e) => setManualUrl(e.target.value)}
                      placeholder="Threads share link or permalink"
                    />
                  </label>
                  <p>
                    Paste a post and optional comments. Each comment occupies
                    one line.
                  </p>
                  <label>
                    Author
                    <input
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                    />
                  </label>
                  <label>
                    Original post
                    <textarea
                      rows={4}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </label>
                  <label>
                    Comments
                    <textarea
                      rows={3}
                      value={comments}
                      onChange={(e) => setComments(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={busy || dirty || !text.trim()}
                    onClick={() =>
                      void run(async () => {
                        accept(
                          await api("/" + session.id, "PUT", {
                            revision: session.revision,
                            manual: { text, author, comments, url: manualUrl },
                          }),
                        );
                        setText("");
                        setComments("");
                        setManual(false);
                        await refresh();
                        setNotice(
                          "Manual source imported. Original text preserved.",
                        );
                      })
                    }
                  >
                    Import source
                  </button>
                </div>
              )}
            </section>
            {session.errors
              .filter(
                (e) =>
                  !(session.attempts || []).some(
                    (a) =>
                      a.status === "PARTIAL" &&
                      a.diagnostics.some(
                        (d) => e === a.originalUrl + ": " + d.message,
                      ),
                  ),
              )
              .map((e) => (
                <div role="alert" className="alert error" key={e}>
                  {e}
                </div>
              ))}
            <StageReportPanel
              id={session.id}
              revision={session.revision}
              dirty={dirty}
            />
            {!!session.attempts?.some((a) => a.contextCandidates?.length) && (
              <details className="panel">
                <summary>
                  Auxiliary context — excluded from target content unless
                  explicitly added
                </summary>
                {session.attempts.flatMap((a) =>
                  (a.contextCandidates || []).map((c, index) => (
                    <div
                      className="context-candidate"
                      key={a.originalUrl + index}
                    >
                      <strong>{c.author}</strong>
                      <p>{c.text}</p>
                      <small>
                        {String(c.url || "No permalink")} · Relationship
                        unverified
                      </small>
                      <button
                        disabled={
                          busy ||
                          dirty ||
                          session.items.some((i) => i.sourceUrl === c.url)
                        }
                        onClick={() =>
                          void run(async () => {
                            accept(
                              await api("/" + session.id, "PUT", {
                                revision: session.revision,
                                addContext: {
                                  originalUrl: a.originalUrl,
                                  index,
                                },
                              }),
                            );
                          })
                        }
                      >
                        Add this context item
                      </button>
                    </div>
                  )),
                )}
              </details>
            )}
            {!!session.attempts?.length && !session.scope && (
              <div className="alert">
                Legacy extraction contains unverified context. Original data is
                preserved.
                <button
                  disabled={busy || dirty}
                  onClick={() =>
                    void run(async () => {
                      accept(
                        await api("/" + session.id + "/exact-copy", "POST"),
                      );
                      await refresh();
                    })
                  }
                >
                  Verify exact targets in a preserved copy
                </button>
              </div>
            )}
            <section className="content-heading">
              <h3>
                Collected content <span>{session.items.length}</span>
              </h3>
              <span>
                {session.items.filter((i) => i.selected).length} selected ·{" "}
                {dirty ? "Unsaved changes" : "Saved"}
                {session.elapsedMs !== undefined
                  ? ` · Extraction ${(session.elapsedMs / 1000).toFixed(1)}s`
                  : ""}
              </span>
            </section>
            {session.items.length === 0 ? (
              <div className="panel empty-small">
                Add a Threads URL or paste source material to begin.
              </div>
            ) : (
              session.items
                .filter(
                  (i) =>
                    i.inclusion === "EXPLICIT_CONTEXT" ||
                    i.inclusion === "MANUAL" ||
                    !session.attempts?.length ||
                    session.attempts.some(
                      (a) =>
                        !!a.matchedTargetId && a.canonicalUrl === i.sourceUrl,
                    ),
                )
                .map((i, index) => (
                  <article
                    className={"content-card " + (i.selected ? "selected" : "")}
                    key={i.id}
                  >
                    <div className="card-head">
                      <label>
                        <input
                          type="checkbox"
                          checked={i.selected}
                          onChange={(e) =>
                            update(i.id, { selected: e.target.checked })
                          }
                        />
                        <strong>{i.author.displayName}</strong>
                        <span className="badge">
                          {i.metadata?.type || i.sourceReference.entityType}
                        </span>
                      </label>
                      <div>
                        <button
                          aria-label="Move up"
                          disabled={index === 0}
                          onClick={() => move(i.id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          aria-label="Move down"
                          disabled={index === session.items.length - 1}
                          onClick={() => move(i.id, 1)}
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                    {i.sourceUrl && (
                      <a href={i.sourceUrl} target="_blank" rel="noreferrer">
                        {i.sourceUrl}
                      </a>
                    )}
                    <ThreadsPreview
                      item={i}
                      disabled={busy || dirty}
                      onRefresh={() =>
                        void run(async () => {
                          accept(
                            await api(
                              "/" + session.id + "/metadata/" + i.id,
                              "POST",
                              { revision: session.revision },
                            ),
                          );
                        })
                      }
                    />
                    <details>
                      <summary>
                        Review original, metadata, media & edit text
                      </summary>
                      <details>
                        <summary>Original source · read only</summary>
                        <p className="original">{i.originalText}</p>
                        {i.mediaReferences.map((m, n) => (
                          <p className="media" key={n}>
                            Media reference: {m}
                          </p>
                        ))}
                      </details>
                      <MetadataEditor
                        item={i}
                        onChange={(patch) => update(i.id, patch)}
                      />
                      <MediaPreview item={i} />
                      <div className="edit-grid">
                        <label>
                          Display text
                          <textarea
                            rows={4}
                            value={i.displayText}
                            onChange={(e) =>
                              update(i.id, { displayText: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Spoken text
                          <textarea
                            rows={4}
                            value={i.spokenText}
                            onChange={(e) =>
                              update(i.id, { spokenText: e.target.value })
                            }
                          />
                        </label>
                      </div>
                      <div className="card-bottom">
                        <small>
                          #{index + 1} · Revision {i.revision} ·{" "}
                          {i.manualLocks.length
                            ? "Manual text locks"
                            : "Original text"}{" "}
                        </small>
                        <button
                          onClick={() =>
                            update(i.id, {
                              displayText: i.originalText,
                              spokenText: i.originalText,
                            })
                          }
                        >
                          Restore original text
                        </button>
                      </div>
                    </details>
                  </article>
                ))
            )}
          </>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
