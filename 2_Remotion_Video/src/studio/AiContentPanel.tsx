import { useEffect, useState } from "react";
import type {
  AiAgentRun,
  AiAssessmentFeedback,
  AiContentAssessment,
  AiScriptProposal,
  AiScriptSection,
  AiScriptReview,
  AiStyle,
} from "../../../1_nest_backend/src/data-engine/ai-contracts";
import { studioRequest } from "./integration-api";

type Status = {
  provider: string;
  config: {
    model: string;
    provider: string;
    credential: "present" | "absent";
    requestBudget: number;
    tokenBudget: number;
  };
  liveCalls: string;
  toolMode: string;
};

export function AiContentPanel({ collectionId }: { collectionId?: string }) {
  const [mode, setMode] = useState<"RULE" | "AI">("RULE");
  const [style, setStyle] = useState<AiStyle>("SERIOUS");
  const [status, setStatus] = useState<Status | null>(null);
  const [assessment, setAssessment] = useState<AiContentAssessment | null>(
    null,
  );
  const [run, setRun] = useState<AiAgentRun | null>(null);
  const [reviewedProposal, setReviewedProposal] =
    useState<AiScriptProposal | null>(null);
  const [feedback, setFeedback] = useState<AiAssessmentFeedback | null>(null);
  const [decision, setDecision] = useState<
    "ACCEPT" | "REJECT" | "NEEDS_REVIEW"
  >("NEEDS_REVIEW");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [feedbackReason, setFeedbackReason] = useState("");
  const [scriptReview, setScriptReview] = useState<AiScriptReview | null>(null);
  const [draftHook, setDraftHook] = useState("");
  const [draftSections, setDraftSections] = useState<AiScriptSection[]>([]);
  const [scriptFeedback, setScriptFeedback] = useState("");
  const [instruction, setInstruction] = useState(
    "Phân tích nội dung đã lưu và đề xuất kịch bản DRAFT có dẫn nguồn.",
  );
  const [duration, setDuration] = useState(75);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activeProposal = reviewedProposal ?? run?.proposal ?? null;

  useEffect(() => {
    let mounted = true;
    setReviewedProposal(null);
    setScriptReview(null);
    void Promise.all([
      studioRequest<Status>("/data/ai/status"),
      studioRequest<AiContentAssessment[]>("/data/ai/assessments"),
      studioRequest<AiAgentRun[]>("/data/ai/agent/runs"),
    ])
      .then(([nextStatus, assessments, runs]) => {
        if (!mounted) return;
        setStatus(nextStatus);
        setAssessment(
          assessments.find((row) => row.collectionId === collectionId) ?? null,
        );
        setRun(
          runs.find((row) => row.collectionIds.includes(collectionId || "")) ??
            null,
        );
      })
      .catch((cause) => mounted && setError(String(cause.message || cause)));
    return () => {
      mounted = false;
    };
  }, [collectionId]);

  useEffect(() => {
    if (!assessment) return;
    void Promise.all([
      studioRequest<AiAssessmentFeedback | null>(
        `/data/ai/assessments/${assessment.id}/feedback`,
      ),
      studioRequest<AiScriptProposal | null>(
        `/data/ai/assessments/${assessment.id}/latest-proposal`,
      ),
    ]).then(([row, proposal]) => {
      setFeedback(row);
      setReviewedProposal(proposal);
      setDecision(row?.decision ?? "NEEDS_REVIEW");
      setSelectedSourceIds(
        row?.selectedSourceIds ?? assessment.selectedSourceIds,
      );
      setFeedbackReason(row?.reason ?? "");
    });
  }, [assessment]);

  useEffect(() => {
    if (!activeProposal) return;
    void studioRequest<AiScriptReview | null>(
      `/data/ai/script-proposals/${activeProposal.id}/review`,
    ).then((row) => {
      setScriptReview(row);
      setDraftHook(row?.hook ?? activeProposal.hook);
      setDraftSections(row?.sections ?? activeProposal.sections);
      setScriptFeedback(row?.feedback ?? "");
    });
  }, [activeProposal?.id]);

  const action = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause: any) {
      setError(String(cause.message || cause));
    } finally {
      setBusy(false);
    }
  };
  const evaluate = () =>
    action(async () => {
      if (!collectionId) throw Error("Hãy chọn một conversation trước.");
      setAssessment(
        await studioRequest<AiContentAssessment>(
          `/data/ai/collections/${collectionId}/evaluate`,
          { confirmLive: true, style },
        ),
      );
    });
  const research = () =>
    action(async () => {
      if (!collectionId) throw Error("Hãy chọn một conversation trước.");
      setRun(
        await studioRequest<AiAgentRun>("/data/ai/agent/runs", {
          confirmLive: true,
          requestId: crypto.randomUUID(),
          instruction,
          style,
          targetDurationSeconds: duration,
          collectionIds: [collectionId],
        }),
      );
    });
  const saveFeedback = () =>
    action(async () => {
      if (!assessment) throw Error("Chưa có AI assessment.");
      const row = await studioRequest<AiAssessmentFeedback>(
        `/data/ai/assessments/${assessment.id}/feedback`,
        {
          requestId: crypto.randomUUID(),
          expectedRevision: feedback?.revision ?? 0,
          decision,
          selectedSourceIds,
          reason: feedbackReason,
        },
      );
      setFeedback(row);
    });
  const saveScriptReview = () =>
    action(async () => {
      if (!activeProposal) throw Error("Chưa có Script DRAFT.");
      const row = await studioRequest<AiScriptReview>(
        `/data/ai/script-proposals/${activeProposal.id}/review`,
        {
          requestId: crypto.randomUUID(),
          expectedRevision: scriptReview?.revision ?? 0,
          hook: draftHook,
          sections: draftSections,
          feedback: scriptFeedback,
        },
      );
      setScriptReview(row);
    });
  const createReviewedDraft = () =>
    action(async () => {
      if (!assessment || !feedback)
        throw Error("Hãy lưu editorial selection trước.");
      const proposal = await studioRequest<AiScriptProposal>(
        `/data/ai/assessments/${assessment.id}/propose-reviewed`,
        {
          confirmLive: true,
          requestId: crypto.randomUUID(),
          expectedFeedbackRevision: feedback.revision,
          targetDurationSeconds: duration,
          instruction,
        },
      );
      setReviewedProposal(proposal);
    });

  return (
    <section className="v2-card" data-testid="ai-content-panel">
      <h3>Content Intelligence · Human review required</h3>
      <p>
        Rule score, AI assessment và editorial decision là ba lớp độc lập. AI
        không ACCEPT, enqueue, TTS, render hay publish.
      </p>
      <div className="actions">
        <label>
          Chế độ
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as "RULE" | "AI")}
          >
            <option value="RULE">Rule-based</option>
            <option value="AI">AI-assisted</option>
          </select>
        </label>
        <label>
          Phong cách
          <select
            value={style}
            onChange={(event) => setStyle(event.target.value as AiStyle)}
          >
            <option value="SERIOUS">SERIOUS</option>
            <option value="FUNNY" disabled>
              FUNNY — legacy, disabled in this stream
            </option>
          </select>
        </label>
      </div>
      <p data-testid="ai-provider-status">
        {status
          ? `${status.provider} · ${status.config.model} · route ${status.config.provider} · credential ${status.config.credential} · calls ${status.liveCalls}`
          : "Provider status unavailable"}
      </p>
      <button
        data-testid="ai-evaluate"
        disabled={
          mode !== "AI" ||
          !collectionId ||
          busy ||
          status?.config.credential !== "present"
        }
        title={
          mode !== "AI"
            ? "Chọn AI-assisted"
            : !collectionId
              ? "Chọn conversation"
              : status?.config.credential !== "present"
                ? "Backend chưa có HUGGINGFACE_API_KEY"
                : "Một explicit live request; cache prevents duplicate spend"
        }
        onClick={() => void evaluate()}
      >
        {busy ? "Đang xử lý…" : "AI đánh giá nội dung"}
      </button>
      {assessment && (
        <details open data-testid="ai-assessment">
          <summary>
            Assessment · {assessment.status} · {assessment.provider.model}
          </summary>
          <p>
            Topic: {assessment.topic} · feasibility{" "}
            {assessment.feasibility.status} · estimated{" "}
            {assessment.feasibility.estimatedSeconds.minimum}–
            {assessment.feasibility.estimatedSeconds.maximum}s (NOT MEASURED)
          </p>
          <p>
            Usage: {assessment.provider.usage.totalTokens ?? "UNAVAILABLE"}{" "}
            tokens · cost{" "}
            {assessment.provider.usage.estimatedCostUsd ?? "UNAVAILABLE"}
          </p>
          <ul>
            {assessment.candidates.map((candidate) => (
              <li key={candidate.sourceId}>
                <input
                  type="checkbox"
                  aria-label={`Chọn ${candidate.sourceId}`}
                  checked={selectedSourceIds.includes(candidate.sourceId)}
                  onChange={(event) =>
                    setSelectedSourceIds((current) =>
                      event.target.checked
                        ? [...new Set([...current, candidate.sourceId])]
                        : current.filter((id) => id !== candidate.sourceId),
                    )
                  }
                />{" "}
                <code>{candidate.sourceId}</code> · {candidate.disposition} ·{" "}
                {candidate.editorialStatus ??
                  (candidate.disposition === "SELECT"
                    ? "SELECT_REQUIRES_HUMAN_REVIEW"
                    : candidate.disposition)}{" "}
                · evidence {candidate.relationshipEvidence ?? "UNKNOWN"} · relation{" "}
                {candidate.contextRelation}
                <br />
                Quality: relevance {candidate.relevance}, information{" "}
                {candidate.quality?.informationValue ?? "UNKNOWN"}, novelty{" "}
                {candidate.quality?.novelty ?? "UNKNOWN"}, argument{" "}
                {candidate.quality?.argumentation ?? "UNKNOWN"}, experience{" "}
                {candidate.quality?.experienceValue ?? "UNKNOWN"}, appeal{" "}
                {candidate.quality?.audienceAppeal ?? "UNKNOWN"}, video{" "}
                {candidate.quality?.videoUsefulness ?? "UNKNOWN"}
                <br />
                {(candidate.reasons ?? []).join("; ")}
                {(candidate.risks?.length ?? 0) > 0 && (
                  <> · Risks: {candidate.risks.join("; ")}</>
                )}
                {(candidate.requiresHumanReview ??
                  candidate.relationshipEvidence !== "PARENT_VERIFIED") && (
                  <strong> · Cần người dùng xác minh quan hệ nguồn</strong>
                )}
              </li>
            ))}
          </ul>
          <details>
            <summary>So sánh heuristic / AI</summary>
            <pre>
              {JSON.stringify(
                {
                  rule: assessment.ruleSnapshot,
                  ai: assessment.feasibility,
                  missing: assessment.missingInformation,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <label>
            Editorial feedback (không phải production approval)
            <select
              value={decision}
              onChange={(event) =>
                setDecision(event.target.value as typeof decision)
              }
            >
              <option value="NEEDS_REVIEW">NEEDS_REVIEW</option>
              <option value="ACCEPT">ACCEPT selection</option>
              <option value="REJECT">REJECT selection</option>
            </select>
          </label>
          <textarea
            value={feedbackReason}
            placeholder="Lý do và điểm cần xác minh"
            onChange={(event) => setFeedbackReason(event.target.value)}
          />
          <button disabled={busy} onClick={() => void saveFeedback()}>
            Lưu AI feedback · revision {feedback?.revision ?? 0}
          </button>
          <button
            data-testid="ai-create-reviewed-draft"
            disabled={
              busy ||
              feedback?.decision !== "ACCEPT" ||
              !feedback.selectedSourceIds.length
            }
            title="Chỉ dùng editorial selection đã lưu; không phải production approval"
            onClick={() => void createReviewedDraft()}
          >
            Tạo Script DRAFT từ selection đã duyệt
          </button>
        </details>
      )}
      <hr />
      <h4>Research Agent V1</h4>
      <p>
        {status?.toolMode || "MODEL_PLANNER_VALIDATED_TOOLS_V1"}: model tạo JSON
        plan; backend kiểm tra schema và chỉ thực thi tool allowlist.
      </p>
      <textarea
        value={instruction}
        maxLength={2000}
        onChange={(event) => setInstruction(event.target.value)}
      />
      <label>
        Target duration (estimated)
        <input
          type="number"
          min={60}
          max={120}
          value={duration}
          onChange={(event) => setDuration(Number(event.target.value))}
        />
      </label>
      <button
        data-testid="ai-research-run"
        disabled={
          !collectionId || busy || status?.config.credential !== "present"
        }
        onClick={() => void research()}
      >
        Tạo đề xuất Script DRAFT
      </button>
      {run && (
        <details open data-testid="ai-agent-run">
          <summary>
            Agent · {run.status} · {run.toolCalls.length} tool calls
          </summary>
          {run.plan && (
            <p>
              Chọn collection <code>{run.plan.selectedCollectionId}</code> ·{" "}
              {run.plan.rationale.join("; ")}
            </p>
          )}
          <ol>
            {run.toolCalls.map((call) => (
              <li key={call.index}>
                {call.tool} · {call.status} · {call.summary}
              </li>
            ))}
          </ol>
          <p>
            Approval: {run.approval} · production approved:{" "}
            {String(run.productionApproved)}
          </p>
        </details>
      )}
      {activeProposal && (
        <div data-testid="ai-script-draft-editor">
          <p>
            Duration: {activeProposal.estimatedDuration.minimum}–
            {activeProposal.estimatedDuration.maximum}s ·{" "}
            {activeProposal.estimatedDuration.source} · gate{" "}
            {activeProposal.durationGate ?? "LEGACY_NOT_EVALUATED"} · selection revision{" "}
            {activeProposal.selectionRevision ?? "AI_RECOMMENDATION"}
          </p>
          {activeProposal.warnings.map((warning) => (
            <p role="status" key={warning}>
              {warning}
            </p>
          ))}
          <label>
            Hook DRAFT
            <textarea
              value={draftHook}
              onChange={(event) => setDraftHook(event.target.value)}
            />
          </label>
          {draftSections.map((section, index) => (
            <label key={section.id || index}>
              {section.kind} ·{" "}
              {section.sourceIds.join(", ") || "original commentary"}
              <textarea
                value={section.text}
                onChange={(event) =>
                  setDraftSections((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, text: event.target.value }
                        : row,
                    ),
                  )
                }
              />
            </label>
          ))}
          <textarea
            value={scriptFeedback}
            placeholder="Phản hồi cho Script DRAFT"
            onChange={(event) => setScriptFeedback(event.target.value)}
          />
          <button disabled={busy} onClick={() => void saveScriptReview()}>
            Lưu Script DRAFT · revision {scriptReview?.revision ?? 0}
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
