import {useRuntimeSafety} from './RuntimeSafety';
import { useEffect, useState } from "react";
import type { StudioSession } from "../../../1_nest_backend/src/studio/studio.contracts";
import { studioRequest } from "./integration-api";
export function EditorialDurationPanel({
  session,
  busy,
  onApprove,
}: {
  session: StudioSession;
  busy?: boolean;
  onApprove?: (revision: number, reason: string) => void;
}) {
  const {locked}=useRuntimeSafety();
  const [report, setReport] = useState<any>(null),
    [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [reviewed, setReviewed] = useState(false);
  useEffect(() => {
    let active = true;
    if (!session.project.editorialPlan) return;
    void studioRequest("/data/editorial/sessions/" + session.id + "/duration")
      .then((x) => {
        if (active) setReport(x);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [session.id, session.revision]);
  if (!session.project.editorialPlan) return null;
  return (
    <section className="v2-card" data-testid="editorial-duration">
      <h3>
        Conversation script {report?.scriptStatus || "DRAFT"} · 70–100s target
      </h3>
      <p>
        Source bundle {session.productionOrigin?.conversation?.collectionId} ·
        script/audio/rights approvals remain independent.
      </p>
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          <p>
            Saved narration ESTIMATED {report.estimated.minimumSeconds}–
            {report.estimated.maximumSeconds}s (advisory, save edits to update).
          </p>
          <p>
            {report.measured.source} · {report.measured.status} · timeline{" "}
            {report.measured.timelineSeconds ?? "unknown"}s · narration{" "}
            {report.measured.narrationSeconds ?? "unknown"}s
          </p>
          <p>
            At or below 60s: DURATION_TOO_SHORT. Never extend with silence,
            repetition or unnatural speed. Duration alone does not grant release
            readiness.
          </p>
        </>
      )}
      {onApprove && (
        <>
          <label>
            <input
              data-testid="editorial-script-review"
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />{" "}
            I reviewed the quoted/paraphrased sources and original commentary.
          </label>
          <input
            data-testid="editorial-script-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Editorial review reason"
          />
          <button
            data-testid="editorial-script-approve"
            disabled={locked || busy || !reviewed || !reason.trim()}
            onClick={() => onApprove(session.revision, reason)}
          >
            Approve script only
          </button>
        </>
      )}
    </section>
  );
}
