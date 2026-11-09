import {useRuntimeSafety} from './RuntimeSafety';
import { useEffect, useState } from "react";
import type { StudioSession } from "../../../1_nest_backend/src/studio/studio.contracts";
import type {
  CreatorInfo,
  PublishingDraft,
  TikTokAccount,
  PublicationJob,
} from "../../../1_nest_backend/src/studio/publishing.types";
import type { RenderManifest } from "../../../1_nest_backend/src/studio/render.types";
import { copyReport } from "./copy-report";
import "./publishing.css";

async function api<T = any>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api/studio" + url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    j = await r.json();
  if (!r.ok)
    throw Error(j.error?.message || j.message || "Publishing request failed");
  return j.data ?? j;
}
interface Overview {
  config: {
    configuration: Record<string, boolean>;
    oauthStatus: string;
    postingStatus: string;
    reasons: string[];
    liveTransferEnabled: boolean;
  };
  accounts: TikTokAccount[];
  draft: PublishingDraft | null;
  jobs: PublicationJob[];
  rights: NonNullable<StudioSession["mediaRights"]>;
  requiredRights?: { id: string; label: string }[];
}
const initial = (revision: number): PublishingDraft => ({
  revision,
  execution: "LIVE",
  mode: "INBOX_UPLOAD",
  accountId: "",
  renderJobId: "",
  caption: "",
  hashtags: [],
  mentions: [],
  coverMs: 0,
  privacy: "",
  allowComment: false,
  allowDuet: false,
  allowStitch: false,
  ownBrand: false,
  paidPartnership: false,
  aiDisclosure: "UNSET",
  musicConsent: false,
  contentConsent: false,
});
export function PublishingWorkspace({
  session,
  busy,
  onSession,
}: {
  session: StudioSession;
  busy: boolean;
  onSession: (s: StudioSession) => void;
}) {
  const [info, setInfo] = useState<Overview | null>(null),
    [draft, setDraft] = useState<PublishingDraft>(initial(session.revision)),
    [renders, setRenders] = useState<RenderManifest[]>([]),
    [creator, setCreator] = useState<CreatorInfo | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [validation, setValidation] = useState<any>(null),
    [name, setName] = useState(""),
    [receipt, setReceipt] = useState<any>(null),
    [confirmation, setConfirmation] = useState(""),
    [dirty, setDirty] = useState(false),
    [report, setReport] = useState("");
  const base = "/sessions/" + session.id,
    account = info?.accounts.find((a) => a.id === draft.accountId),
    render = renders.find((r) => r.jobId === draft.renderJobId);
  const run = async (fn: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const refresh = async () => {
    const [data, r] = await Promise.all([
      api<Overview>(base + "/publishing"),
      api<{ renders: RenderManifest[] }>(base + "/render"),
    ]);
    setInfo(data);
    setRenders(r.renders);
    return data;
  };
  useEffect(() => {
    let live = true;
    void Promise.all([
      api<Overview>(base + "/publishing"),
      api<{ renders: RenderManifest[] }>(base + "/render"),
    ])
      .then(([data, r]) => {
        if (!live) return;
        setInfo(data);
        setRenders(r.renders);
        setDraft(
          data.draft
            ? { ...data.draft, revision: session.revision }
            : initial(session.revision),
        );
        setDirty(false);
        setValidation(null);
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [base]);
  useEffect(() => {
    setDraft((d) => ({ ...d, revision: session.revision }));
    setReceipt(null);
    setValidation(null);
  }, [session.revision]);
  useEffect(() => {
    let live = true;
    setCreator(null);
    if (draft.accountId && draft.mode === "DIRECT_POST")
      void api<CreatorInfo>(
        "/tiktok/accounts/" + draft.accountId + "/creator-info",
        "POST",
        {},
      )
        .then((c) => {
          if (live) setCreator(c);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [draft.accountId, draft.mode]);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);
  const change = (patch: Partial<PublishingDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setReceipt(null);
    setValidation(null);
  };
  const check = async () => {
    const v = await api(base + "/publishing/validate", "POST", draft);
    setValidation(v);
    return v;
  };
  const exportReport = async (json = false) => {
    const persisted = await api<Overview>(base + "/publishing"),
      v = await api(
        base + "/publishing/validate",
        "POST",
        persisted.draft || draft,
      );
    const out = {
      stageName: "PUBLISH",
      sessionId: session.id,
      revision: session.revision,
      generatedAt: new Date().toISOString(),
      configuration: persisted.config,
      accounts: persisted.accounts.map(({ subjectHash, ...a }) => a),
      savedDraft: persisted.draft,
      validation: v,
      rights: persisted.rights,
      jobs: persisted.jobs,
      note: "No LIVE upload/post implementation is enabled. MOCK is a simulation, not a published video.",
    };
    const text = json
      ? JSON.stringify(out, null, 2)
      : "# Publishing Stage Report\n\n```json\n" +
        JSON.stringify(out, null, 2) +
        "\n```";
    setReport(text);
    if (json) {
      const u = URL.createObjectURL(
          new Blob([text], { type: "application/json" }),
        ),
        a = document.createElement("a");
      a.href = u;
      a.download = "publishing-" + session.id + ".json";
      a.click();
      URL.revokeObjectURL(u);
    } else {
      await copyReport(text);
      setNotice("Report copied from persisted data.");
    }
  };
  const rightsIds = Array.from(
    new Set([
      ...session.items.filter((i) => i.selected).map((i) => "source:" + i.id),
      "model:KOKORO",
      ...(info?.requiredRights || []).map((a) => a.id),
      ...Object.keys(info?.rights || {}),
    ]),
  );
  const {locked}=useRuntimeSafety();
  const disabled = locked || busy || pending;
  return (
    <section className="publish-workspace" data-testid="publishing-workspace">
      <header>
        <div>
          <h2>06 / TikTok Publishing Foundation</h2>
          <p>
            {session.title} ·{" "}
            {dirty ? "Unsaved publishing draft" : "Saved publishing settings"} ·
            revision {session.revision}
          </p>
        </div>
        <div>
          <button
            disabled={disabled}
            onClick={() => void run(() => exportReport())}
          >
            Copy Report
          </button>
          <button
            disabled={disabled}
            onClick={() => void run(() => exportReport(true))}
          >
            Export JSON
          </button>
        </div>
      </header>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="alert">
        <strong>
          {info?.config.oauthStatus || "Checking authentication"} ·{" "}
          {info?.config.postingStatus || "BLOCKED_APP_APPROVAL"}
        </strong>
        <p>Media rights: {(info?.requiredRights || []).some(({id}) => !info?.rights[id] || info.rights[id].status === 'UNKNOWN' || !info.rights[id].evidence.trim()) ? 'UNKNOWN — Publishing is blocked until evidence is supplied.' : 'Declarations still require review; app and FINAL gates remain enforced.'}</p>
        <p>
          LIVE transfer is disabled. This internal utility and reuse of
          third-party Threads content have not been verified as eligible for
          TikTok approval. No upload is performed by this foundation.
        </p>
        <a
          href="https://developers.tiktok.com/docs/en/content-sharing-guidelines"
          target="_blank"
          rel="noreferrer"
        >
          Official content sharing requirements
        </a>
      </div>
      <div className="publish-grid">
        <div className="panel">
          <h3>Account Manager</h3>
          <label>
            Environment
            <select
              aria-label="Publishing environment"
              value={draft.execution}
              disabled={disabled}
              onChange={(e) =>
                change({
                  execution: e.target.value as PublishingDraft["execution"],
                  accountId: "",
                  privacy: "",
                })
              }
            >
              <option value="LIVE">
                LIVE — authentication/app approval required
              </option>
              <option value="MOCK">MOCK — local simulation only</option>
            </select>
          </label>
          <label>
            Selected account
            <select
              aria-label="TikTok account"
              disabled={disabled}
              value={draft.accountId}
              onChange={(e) =>
                change({ accountId: e.target.value, privacy: "" })
              }
            >
              <option value="">Select an account</option>
              {info?.accounts
                .filter(
                  (a) =>
                    a.mode === draft.execution && a.status !== "DISCONNECTED",
                )
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nickname} ·{" "}
                    {a.username ? "@" + a.username : "username unavailable"} ·{" "}
                    {a.status}
                  </option>
                ))}
            </select>
          </label>
          {account && (
            <div className="publish-account">
              {(creator?.creator_avatar_url || account.avatarUrl) && (
                <img
                  src={creator?.creator_avatar_url || account.avatarUrl || ""}
                  alt="Selected TikTok account avatar"
                />
              )}
              <div>
                <strong>{creator?.creator_nickname || account.nickname}</strong>
                <p>
                  {creator?.creator_username ||
                    account.username ||
                    "Username unavailable under current scope"}
                </p>
                <small>
                  {account.mode} · {account.scopes.join(", ")} ·{" "}
                  {account.status}
                </small>
              </div>
            </div>
          )}
          {draft.execution === "LIVE" ? (
            <>
              <button
                disabled={
                  disabled ||
                  info?.config.oauthStatus !== "CONFIGURED_NOT_LIVE_VERIFIED"
                }
                onClick={() =>
                  void run(async () => {
                    const r = await api("/tiktok/oauth/start", "POST", {
                      sessionId: session.id,
                      mode: draft.mode,
                    });
                    window.location.assign(r.url);
                  })
                }
              >
                Connect with TikTok OAuth
              </button>
              <small>
                Registered HTTPS callback and backend-only
                credentials/encryption key are required. No password or browser
                cookies.
              </small>
              <details>
                <summary>Configuration presence (no values)</summary>
                {Object.entries(info?.config.configuration || {}).map(
                  ([k, v]) => (
                    <p key={k}>
                      {k}: {v ? "present" : "absent"}
                    </p>
                  ),
                )}
              </details>
            </>
          ) : (
            <>
              <label>
                MOCK account label
                <input
                  aria-label="Mock account label"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name this local test account"
                />
              </label>
              <button
                disabled={disabled || !name.trim()}
                onClick={() =>
                  void run(async () => {
                    const a = await api<TikTokAccount>(
                      "/tiktok/mock-accounts",
                      "POST",
                      { nickname: name },
                    );
                    await refresh();
                    change({ accountId: a.id });
                    setName("");
                  })
                }
              >
                Create local MOCK account
              </button>
            </>
          )}
          {account && (
            <div className="actions">
              <button
                disabled={disabled}
                onClick={() =>
                  void run(async () => {
                    await api(
                      "/tiktok/accounts/" + account.id + "/refresh",
                      "POST",
                      {},
                    );
                    await refresh();
                    setNotice("Account refreshed; no video sent.");
                  })
                }
              >
                Refresh token
              </button>
              <button
                disabled={disabled}
                onClick={() => {
                  if (
                    window.confirm(
                      "Revoke authorization and disconnect this account?",
                    )
                  )
                    void run(async () => {
                      await api(
                        "/tiktok/accounts/" + account.id + "/disconnect",
                        "POST",
                        {},
                      );
                      await refresh();
                      change({ accountId: "" });
                    });
                }}
              >
                Revoke & disconnect
              </button>
            </div>
          )}
        </div>
        <div className="panel">
          <h3>Video & posting mode</h3>
          <label>
            Mode
            <select
              aria-label="Posting mode"
              value={draft.mode}
              disabled={disabled}
              onChange={(e) =>
                change({
                  mode: e.target.value as PublishingDraft["mode"],
                  privacy: "",
                })
              }
            >
              <option value="INBOX_UPLOAD">
                A. Upload to TikTok inbox — finish in TikTok
              </option>
              <option value="DIRECT_POST">
                B. Direct Post — audited client required
              </option>
            </select>
          </label>
          <label>
            Retained video
            <select
              aria-label="Publishing video"
              disabled={disabled}
              value={draft.renderJobId}
              onChange={(e) =>
                change({ renderJobId: e.target.value, coverMs: 0 })
              }
            >
              <option value="">Choose a completed FINAL render</option>
              {renders
                .filter((r) => r.status === "COMPLETED")
                .map((r) => (
                  <option value={r.jobId} key={r.jobId}>
                    {r.mode} · {r.width}×{r.height} ·{" "}
                    {r.expectedDurationSeconds.toFixed(2)}s ·{" "}
                    {r.jobId.slice(0, 8)}
                  </option>
                ))}
            </select>
          </label>
          {render && (
            <>
              <p>
                {render.mode === "DRAFT"
                  ? "BLOCKED_FINAL: DRAFT is review-only and cannot be submitted."
                  : "FINAL: current revision, approvals and rights will be checked again."}
              </p>
              <video
                controls
                preload="none"
                src={render.downloadUrl}
                onSeeked={(e) =>
                  change({
                    coverMs: Math.round(e.currentTarget.currentTime * 1000),
                  })
                }
              />
              <label>
                Cover timestamp (ms)
                <input
                  aria-label="Cover timestamp"
                  type="number"
                  min="0"
                  max={Math.max(0, render.expectedDurationSeconds * 1000 - 1)}
                  step="1"
                  value={draft.coverMs}
                  onChange={(e) => change({ coverMs: Number(e.target.value) })}
                />
              </label>
              <small>
                Seek the retained video to select a cover. Inbox mode applies
                the cover in TikTok.
              </small>
            </>
          )}
          {draft.mode === "INBOX_UPLOAD" && (
            <p className="alert">
              Inbox upload transfers the video only. Caption, mentions, cover,
              privacy, interactions and disclosures below are notes for
              completion inside TikTok, not API-applied settings.
            </p>
          )}
          {draft.mode === "DIRECT_POST" && (
            <>
              <button
                disabled={disabled || !account}
                onClick={() =>
                  void run(async () =>
                    setCreator(
                      await api(
                        "/tiktok/accounts/" + account!.id + "/creator-info",
                        "POST",
                        {},
                      ),
                    ),
                  )
                }
              >
                Refresh Creator Info
              </button>
              <p>
                {creator
                  ? creator.source + " · " + creator.checkedAt
                  : "Creator Info unavailable — no privacy option is assumed."}
              </p>
              <label>
                Privacy
                <select
                  disabled={!creator || disabled}
                  value={draft.privacy}
                  onChange={(e) => change({ privacy: e.target.value })}
                >
                  <option value="">Choose explicitly</option>
                  {creator?.privacy_level_options.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              {(["Comment", "Duet", "Stitch"] as const).map((n) => {
                const key = ("allow" + n) as
                    | "allowComment"
                    | "allowDuet"
                    | "allowStitch",
                  off =
                    !creator ||
                    creator[
                      (n.toLowerCase() + "_disabled") as
                        | "comment_disabled"
                        | "duet_disabled"
                        | "stitch_disabled"
                    ];
                return (
                  <label key={n}>
                    <input
                      type="checkbox"
                      checked={draft[key]}
                      disabled={disabled || off}
                      onChange={(e) => change({ [key]: e.target.checked })}
                    />
                    Allow {n}
                    {off ? " (not available)" : ""}
                  </label>
                );
              })}
            </>
          )}
        </div>
        <div className="panel">
          <h3>Caption & disclosures</h3>
          <label>
            Caption
            <textarea
              aria-label="Publishing caption"
              rows={4}
              maxLength={2200}
              value={draft.caption}
              onChange={(e) => change({ caption: e.target.value })}
            />
          </label>
          <label>
            Hashtags (space separated)
            <input
              value={draft.hashtags.join(" ")}
              onChange={(e) =>
                change({
                  hashtags: e.target.value.trim().split(/\s+/).filter(Boolean),
                })
              }
            />
          </label>
          <label>
            Mentions (space separated)
            <input
              value={draft.mentions.join(" ")}
              onChange={(e) =>
                change({
                  mentions: e.target.value.trim().split(/\s+/).filter(Boolean),
                })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.ownBrand}
              onChange={(e) => change({ ownBrand: e.target.checked })}
            />
            Promoting my own brand
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.paidPartnership}
              onChange={(e) => change({ paidPartnership: e.target.checked })}
            />
            Paid partnership / branded content
          </label>
          <label>
            AI-generated content disclosure
            <select
              value={draft.aiDisclosure}
              onChange={(e) =>
                change({
                  aiDisclosure: e.target
                    .value as PublishingDraft["aiDisclosure"],
                })
              }
            >
              <option value="UNSET">
                Review required — no default assertion
              </option>
              <option value="YES">Yes, disclose AI-generated content</option>
              <option value="NO">No (user decision)</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.musicConsent}
              onChange={(e) => change({ musicConsent: e.target.checked })}
            />
            I have reviewed music usage rights and TikTok Music Usage
            Confirmation.
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.contentConsent}
              onChange={(e) => change({ contentConsent: e.target.checked })}
            />
            I have reviewed content ownership, disclosure and TikTok Branded
            Content Policy.
          </label>
          <a
            href="https://developers.tiktok.com/doc/content-posting-api-get-started/"
            target="_blank"
            rel="noreferrer"
          >
            Official API guide
          </a>
        </div>
      </div>
      <details className="panel">
        <summary>Media rights — UNKNOWN blocks Publishing</summary>
        <p>
          No rights are inferred from a public URL, local file or successful
          DRAFT render. Undeclared rights remain UNKNOWN until evidence is supplied.
        </p>
        {rightsIds.map((id) => (
          <RightsRow
            key={id}
            id={id}
            value={info?.rights[id]}
            disabled={disabled}
            save={(value) =>
              run(async () => {
                const updated = await api<StudioSession>(
                  base + "/publishing/rights",
                  "POST",
                  { revision: session.revision, assetId: id, ...value },
                );
                onSession(updated);
                await refresh();
                setNotice(
                  "Rights declaration saved; no content/audio approval was changed.",
                );
              })
            }
          />
        ))}
      </details>
      <div className="actions">
        <button
          disabled={disabled}
          onClick={() =>
            void run(async () => {
              await api(base + "/publishing/draft", "PUT", draft);
              setDirty(false);
              await refresh();
              setNotice("Publishing draft saved. No video sent.");
            })
          }
        >
          Save publishing draft
        </button>
        <button
          disabled={disabled}
          onClick={() =>
            void run(async () => {
              await check();
            })
          }
        >
          Validate publishing gates
        </button>
        <button
          disabled={disabled || !validation?.ready}
          onClick={() =>
            void run(async () => {
              const r = await api(base + "/publishing/consent", "POST", draft);
              setReceipt(r);
              setConfirmation("");
            })
          }
        >
          Review this submission
        </button>
      </div>
      {validation && (
        <div className="panel" data-testid="publishing-validation">
          <strong>
            {validation.ready ? "READY FOR EXPLICIT CONFIRMATION" : "BLOCKED"}
          </strong>
          {validation.errors.map((e: string, i: number) => (
            <p key={i} className="alert error">
              {e}
            </p>
          ))}
          {validation.warnings.map((w: string, i: number) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}
      {receipt?.receipt && (
        <div className="panel">
          <h3>Per-attempt confirmation ({draft.execution})</h3>
          <p>
            Account: {account?.nickname}. Mode: {draft.mode}. Video:{" "}
            {draft.renderJobId}. Receipt expires after 30 seconds.
          </p>
          <p>
            Type: <code>{receipt.confirmation}</code>
          </p>
          <input
            aria-label="Submission confirmation"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
          <button
            disabled={
              disabled ||
              confirmation !== receipt.confirmation ||
              draft.execution !== "MOCK"
            }
            onClick={() =>
              void run(async () => {
                const result = await api(base + "/publishing/submit", "POST", {
                  draft,
                  receipt: receipt.receipt,
                  confirmation,
                });
                setReceipt(null);
                await refresh();
                setNotice(result.status + " — MOCK sends no bytes to TikTok.");
              })
            }
          >
            Confirm MOCK submission
          </button>
        </div>
      )}
      <div className="panel">
        <h3>Publication history</h3>
        {!info?.jobs.length && (
          <p>No publication jobs. No LIVE video has been submitted.</p>
        )}
        {info?.jobs.map((j) => (
          <article key={j.id}>
            <strong>
              {j.execution} · {j.status}
            </strong>
            <p>
              {j.stage} · {j.createdAt} · {j.id}
            </p>
            {[...j.errors, ...j.warnings].map((s, i) => (
              <p key={i}>{s}</p>
            ))}
            <button
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  const out = await api(base + "/publishing/jobs/" + j.id);
                  setNotice(JSON.stringify(out));
                })
              }
            >
              Refresh status
            </button>
          </article>
        ))}
      </div>
      {report && (
        <details>
          <summary>Readable Publishing Report</summary>
          <textarea
            readOnly
            value={report}
            style={{ width: "100%", minHeight: 220 }}
          />
        </details>
      )}
    </section>
  );
}
function RightsRow({
  id,
  value,
  disabled,
  save,
}: {
  id: string;
  value?: NonNullable<StudioSession["mediaRights"]>[string];
  disabled: boolean;
  save: (value: { status: string; evidence: string }) => Promise<void>;
}) {
  const [status, setStatus] = useState(value?.status || "UNKNOWN"),
    [evidence, setEvidence] = useState(value?.evidence || "");
  return (
    <div className="rights-row">
      <code>{id}</code>
      <select
        aria-label={"Rights " + id}
        value={status}
        onChange={(e) => setStatus(e.target.value as typeof status)}
      >
        {["UNKNOWN", "OWNED", "LICENSED", "PERMISSION"].map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <input
        aria-label={"Evidence " + id}
        value={evidence}
        placeholder="Evidence / licence reference"
        maxLength={2000}
        onChange={(e) => setEvidence(e.target.value)}
      />
      <button
        disabled={disabled || (status !== "UNKNOWN" && !evidence.trim())}
        onClick={() => void save({ status, evidence })}
      >
        Save declaration
      </button>
    </div>
  );
}
