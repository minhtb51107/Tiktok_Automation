import { useEffect, useState, useRef } from "react";
import type { StudioJob } from "../../../1_nest_backend/src/studio/progress";
export function ProgressPanel({
  id,
  onActive,
  onCompleted,
}: {
  id: string;
  onActive: (v: boolean) => void;
  onCompleted: () => void;
}) {
  const [jobs, setJobs] = useState<StudioJob[]>([]),
    [clock, setClock] = useState(Date.now()),
    [message, setMessage] = useState("");
  const seen = useRef(new Map<string, string>()),
    complete = useRef(onCompleted);
  complete.current = onCompleted;
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    seen.current.clear();
    setJobs([]);
    const poll = async () => {
      try {
        const r = await fetch(`/api/studio/sessions/${id}/jobs`);
        if (!r.ok) throw Error("Progress unavailable");
        const j = await r.json(),
          rows: StudioJob[] = j.data ?? j;
        if (!alive) return;
        setJobs(rows);
        onActive(rows.some((j) => ["QUEUED", "RUNNING"].includes(j.status)));
        for (const row of rows) {
          if (
            ["QUEUED", "RUNNING"].includes(seen.current.get(row.jobId) || "") &&
            !["QUEUED", "RUNNING"].includes(row.status)
          )
            complete.current();
          seen.current.set(row.jobId, row.status);
        }
      } catch {
        if (alive) setMessage("Không đọc được tiến trình; sẽ thử lại.");
      } finally {
        if (alive) timer = setTimeout(poll, 1500);
      }
    };
    void poll();
    const tick = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(tick);
      onActive(false);
    };
  }, [id, onActive]);
  const markdown = () =>
    [
      "# Studio Job Report",
      ...jobs.map(
        (j) =>
          `\n## ${j.jobId}\n${j.operation} — ${j.status}\nStep: ${j.currentStep}\nElapsed: ${j.elapsedMs} ms | Completed: ${j.completed ?? "unknown"}/${j.total ?? "unknown"} | ETA: unavailable\nRevision: ${j.revision ?? "unavailable"}\nError: ${j.error ?? "none"}\nWarnings: ${j.warnings.join("; ") || "none"}\n`,
      ),
    ].join("\n");
  return (
    <section className="panel progress-panel">
      <div className="panel-top">
        <h3>Tiến trình & lịch sử tác vụ</h3>
        <span>Polling nhẹ · không có ETA giả</span>
      </div>
      <div className="actions">
        <button
          onClick={() =>
            void navigator.clipboard
              .writeText(markdown())
              .then(() => setMessage("Job report copied."))
              .catch(() => setMessage("Clipboard unavailable"))
          }
        >
          Copy Job Report
        </button>
        <button
          onClick={() => {
            const u = URL.createObjectURL(
              new Blob([JSON.stringify(jobs, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = u;
            a.download = "studio-jobs.json";
            a.click();
            URL.revokeObjectURL(u);
          }}
        >
          Export Jobs JSON
        </button>
        <small>{message}</small>
      </div>
      {!jobs.length && (
        <small>Chưa có tác vụ được ghi nhận bằng hệ thống progress mới.</small>
      )}
      {jobs.slice(0, 5).map((j) => {
        const running = ["RUNNING", "QUEUED"].includes(j.status);
        const elapsed =
          running && j.startedAt
            ? Math.max(0, clock - Date.parse(j.startedAt))
            : j.elapsedMs;
        return (
          <details key={j.jobId} open={running}>
            <summary>
              {j.currentStage} · <b>{j.status}</b> · {j.currentStep} ·{" "}
              {(elapsed / 1000).toFixed(1)}s
            </summary>
            {running &&
              (j.total !== null && j.total > 0 ? (
                <progress max={j.total} value={j.completed ?? 0} />
              ) : (
                <progress />
              ))}
            <p>
              {j.completed !== null && j.total !== null
                ? `${j.completed}/${j.total} đơn vị đã xử lý`
                : "Tiến trình bước hiện tại: chưa đo được phần trăm."}{" "}
              · ETA: chưa có cơ sở.
            </p>
            <small>Job ID: {j.jobId}</small>
            {j.error && <p className="error">{j.error}</p>}
            {j.warnings.map((w, n) => (
              <p className="warning" key={n}>
                {w}
              </p>
            ))}
            {running && (
              <button
                disabled={j.cancelRequested}
                onClick={() =>
                  void fetch(`/api/studio/jobs/${j.jobId}/cancel`, {
                    method: "POST",
                  })
                }
              >
                {j.cancelRequested
                  ? "Đã yêu cầu dừng sau thao tác hiện tại"
                  : "Yêu cầu hủy an toàn"}
              </button>
            )}
            <ol>
              {j.events.map((e, n) => (
                <li key={n}>{e.step}</li>
              ))}
            </ol>
          </details>
        );
      })}
    </section>
  );
}
