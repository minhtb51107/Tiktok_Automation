import { useState } from "react";

export interface ProductPipelineView {
  id: string;
  sessionId: string;
  sourceUrl: string;
  nextStage: string | null;
  stages: Record<string, { status: string; reason: string; evidence: string[] }>;
  latestRenderJobId: string | null;
  collectionId: string | null;
  assessmentId: string | null;
  editorialPlanId?: string | null;
  scriptProposalId?: string | null;
  scriptReviewRevision?: number | null;
  warnings: string[];
}
export interface AutonomousBatchView {
  id: string;
  request: { topic: string; targetVideos: number };
  status: string;
  stage: string;
  results: Array<{
    sourceUrl: string;
    sessionId: string | null;
    status: string;
    measuredSeconds: number | null;
    timelineSeconds: number | null;
  }>;
  errors: string[];
}

const ORDER = ["SOURCE", "AI_QUALITY", "HUMAN_REVIEW", "SCRIPT", "VOICE", "EDITOR", "MP4"];

export function ProjectList({ projects, productJobs, autonomousBatches, busy, onOpen, onQueue, onReview, onApplyReview, onCreate, onCreateFromUrl, onGenerateVideos }: {
  projects: { id: string; title: string; updatedAt?: string }[];
  productJobs: ProductPipelineView[];
  autonomousBatches: AutonomousBatchView[];
  busy: boolean;
  onOpen: (id: string) => void;
  onQueue: () => void;
  onReview: (job: ProductPipelineView) => void;
  onApplyReview: (job: ProductPipelineView) => void;
  onCreate: () => void;
  onCreateFromUrl: (url: string) => void;
  onGenerateVideos: (topic: string, targetVideos: number, keywords?: string[]) => void;
}) {
  const [url, setUrl] = useState("");
  const [topic, setTopic] = useState("công việc");
  const [targetVideos, setTargetVideos] = useState(3);
  const [expansions, setExpansions] = useState('');
  return <section className="v2-workspace" data-testid="project-list">
    <div className="v2-page-header"><div><h2>Video Projects</h2><p>One resumable path: Threads URL → Source → AI quality → human review → Script → Voice → Editor → MP4.</p></div><div className="actions"><button onClick={onQueue}>Production Queue / existing outputs</button><button disabled={busy} onClick={onCreate}>New empty SERIOUS project</button></div></div>
    <article className="v2-card product-url-start"><h3>Start from one canonical Threads URL</h3><p>This explicit LIVE action uses the existing bounded collector once. AI, TTS, render and publishing never start automatically.</p><div className="actions"><input aria-label="Threads URL for product pipeline" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://www.threads.com/@handle/post/id"/><button data-testid="start-url-pipeline" disabled={busy || !url.trim()} onClick={() => onCreateFromUrl(url.trim())}>Collect into DRAFT project</button></div></article>
    <article className="v2-card product-url-start" data-testid="autonomous-video-generator"><h3>Generate Videos</h3><p>One bounded SERIOUS batch: discovery → verified source selection → Qwen quality → Kokoro → timeline → DRAFT MP4. It never publishes or marks content USER_APPROVED.</p><div className="actions"><input aria-label="Video topic" value={topic} onChange={event => setTopic(event.target.value)} placeholder="Chủ đề"/><input aria-label="Optional search expansions" value={expansions} onChange={event=>setExpansions(event.target.value)} placeholder="Từ khóa mở rộng tùy chọn, cách nhau bằng dấu phẩy"/><select aria-label="Number of videos" value={targetVideos} onChange={event => setTargetVideos(Number(event.target.value))}><option value={1}>1 video</option><option value={2}>2 videos</option><option value={3}>3 videos</option></select><button data-testid="generate-videos" disabled={busy || !topic.trim()} onClick={() => onGenerateVideos(topic.trim(), targetVideos, expansions.split(',').map(value=>value.trim()).filter(Boolean))}>Generate Videos</button></div></article>
    {!!autonomousBatches.length && <section><h3>Autonomous DRAFT batches</h3><div className="uiops-project-grid">{autonomousBatches.map(batch => <article className="v2-card" key={batch.id} data-auto-batch={batch.id}><strong>{batch.status} · {batch.stage}</strong><p>{batch.request.topic} · target {batch.request.targetVideos}</p>{batch.results.map((result,index)=><div key={result.sourceUrl+index}><a href={result.sourceUrl} target="_blank" rel="noreferrer">{result.sourceUrl}</a><small>{result.status}{result.timelineSeconds ? ` · ${result.timelineSeconds}s` : result.measuredSeconds ? ` · voice ${result.measuredSeconds}s` : ""}</small>{result.sessionId&&<button disabled={busy} onClick={()=>onOpen(result.sessionId!)}>Open DRAFT</button>}</div>)}{batch.errors.map(error=><small key={error} className="error">{error}</small>)}</article>)}</div></section>}
    {!!productJobs.length && <section><h3>URL → Video jobs</h3><div className="uiops-project-grid">{productJobs.map(job => <article className="v2-card" key={job.id} data-product-job={job.id}><strong>{job.nextStage ? `Next: ${job.nextStage}` : "DRAFT MP4 ready"}</strong><a href={job.sourceUrl} target="_blank" rel="noreferrer">{job.sourceUrl}</a><ol className="product-stage-list">{ORDER.map(stage => <li key={stage} data-status={job.stages[stage]?.status}><b>{stage}</b> · {job.stages[stage]?.status}<small>{job.stages[stage]?.reason}</small></li>)}</ol><div className="actions"><button disabled={busy} onClick={() => onOpen(job.sessionId)}>Continue project → {job.nextStage || "MP4 Output"}</button><button disabled={busy || !job.collectionId} title={!job.collectionId ? "Source collection is not ready" : ""} onClick={() => onReview(job)}>AI quality / human review</button><button disabled={busy || !job.collectionId} onClick={() => onApplyReview(job)}>Apply accepted review</button></div></article>)}</div></section>}
    <div className="uiops-project-grid">{projects.map(project => <article key={project.id} className="v2-card"><h3>{project.title || "Untitled project"}</h3><code>{project.id}</code><p>{project.updatedAt ? new Date(project.updatedAt).toLocaleString("vi-VN") : "Updated time UNKNOWN"}</p><button data-project-id={project.id} disabled={busy} onClick={() => onOpen(project.id)}>Open project → Source</button></article>)}</div>{!projects.length && <p>No saved projects. Opening this page creates nothing.</p>}
  </section>;
}
