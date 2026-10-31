import { useEffect, useState } from "react";
import type { StageReport } from "../../../1_nest_backend/src/studio/stage-report";
export function StageReportPanel({
  id,
  revision,
  dirty,
}: {
  id: string;
  revision: number;
  dirty: boolean;
}) {
  const [data, setData] = useState<{
      report: StageReport;
      markdown: string;
    } | null>(null),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    fetch(`/api/studio/sessions/${id}/report`)
      .then(async (r) => {
        if (!r.ok) throw Error("Report unavailable");
        const j = await r.json();
        if (active) setData(j.data ?? j);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, revision]);
  const download = () => {
    if (!data) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data.report, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `source-report-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="panel">
      <div className="panel-top">
        <h3>Source stage report</h3>
        <span>Persisted revision {data?.report.revision ?? "…"}</span>
      </div>
      {data && (
        <div className="actions">
          {Object.entries(data.report.counts)
            .filter(([k]) =>
              [
                "inputUrls",
                "resolvedTargets",
                "unresolvedTargets",
                "excludedContext",
              ].includes(k),
            )
            .map(([k, v]) => (
              <span className="badge" key={k}>
                {k}: {v}
              </span>
            ))}
        </div>
      )}
      <div className="actions">
        <button
          disabled={dirty || !data}
          onClick={() =>
            void navigator.clipboard
              .writeText(data!.markdown)
              .then(() => setMessage("Report copied."))
              .catch(() =>
                setMessage(
                  "Clipboard unavailable: expand the report below and copy its text.",
                ),
              )
          }
        >
          Copy Report
        </button>
        <button disabled={dirty || !data} onClick={download}>
          Export JSON
        </button>
        <small role="status">
          {dirty ? "Save edits to refresh the report." : message}
        </small>
      </div>
      {data && (
        <details>
          <summary>Readable Source Report</summary>
          <pre className="report-text">{data.markdown}</pre>
        </details>
      )}
    </section>
  );
}
