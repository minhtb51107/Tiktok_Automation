import { useEffect, useState } from "react";
import type {
  AiAgentRun,
  AiContentAssessment,
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
  const [instruction, setInstruction] = useState(
    "Phân tích nội dung đã lưu và đề xuất kịch bản DRAFT có dẫn nguồn.",
  );
  const [duration, setDuration] = useState(75);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
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
                <code>{candidate.sourceId}</code> · {candidate.disposition} ·{" "}
                {candidate.contextRelation} · {candidate.reasons.join("; ")}
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
        </details>
      )}
      <hr />
      <h4>Research Agent V1</h4>
      <p>
        {status?.toolMode || "DETERMINISTIC_ORCHESTRATION_V1"}: tool calls được
        backend kiểm tra; chưa tuyên bố model-driven function calling.
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
          <ol>
            {run.toolCalls.map((call) => (
              <li key={call.index}>
                {call.tool} · {call.status} · {call.summary}
              </li>
            ))}
          </ol>
          {run.proposal && <pre>{JSON.stringify(run.proposal, null, 2)}</pre>}
          <p>
            Approval: {run.approval} · production approved:{" "}
            {String(run.productionApproved)}
          </p>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
