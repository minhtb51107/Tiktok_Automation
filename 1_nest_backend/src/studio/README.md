# Content Studio UI-01

UI-01.2: Source extraction defaults to TARGET_ONLY. DOM target identity matches the exact permalink ID, never a text prefix. Missing/ambiguous identity returns unresolved; public canonical metadata can provide a partial target when it independently matches the resolved permalink. Context candidates live separately in attempts; WITH_CONTEXT exposes auxiliary candidates and each Add action explicitly imports a chosen candidate. Target-only content is not automatically expanded into editors.

POST `/api/studio/sessions/:id/exact-copy` is an explicit live extraction action: it preserves the original session unchanged, creates a derived project, rechecks its supplied URLs and transfers matching user edits/locks. The old items are also archived in the derived session. Loading a project or report never invokes extraction.

GET `/api/studio/sessions/:id/report` returns `{report,markdown}` in the existing data envelope. StageReport supports SOURCE/SCRIPT/VOICE/EDITOR/RENDER/PUBLISH; only Source is implemented. Reports include run/revision/timing/counts, exact target evidence, unavailable metadata, warnings and measured metrics. Counts distinguish project items from context occurrences that were not explicitly added. Costs remain null until measured. Raw browser errors, runtime paths, cookies, profiles, headers and env values are not exported. Source URLs and public content are preserved; URL query strings are omitted from exported links. Save edits before Copy Report or Export JSON.

Build sequentially using existing dependencies:

```powershell
cd D:\LCOM108_NMLT\code\100_bai_code\Tiktok_Automation\2_Remotion_Video
npm run studio:build
cd ..\1_nest_backend
npm run build
npm run studio:start
```

Open http://127.0.0.1:3000/studio (PORT can change the port). One Nest server serves React and the API. `studio:start` checks the port before starting and refuses a second backend. Stop the foreground server with Ctrl+C. For restart: stop the verified project process, build sequentially, then run `npm run studio:start`. Inspect ownership first with `Get-NetTCPConnection -LocalPort 3000 -State Listen` and `Get-CimInstance Win32_Process -Filter 'ProcessId=<PID>'`; never stop an unrelated process.

Data lives in the ignored backend `.studio-data` directory. Back up this directory to preserve projects. Browser edits require Save; reopening reads the persisted session. No database is used. UI-01.1 accepts canonical/share URLs with query parameters and legacy threads.net links; each redirect is bounded, HTTPS/domain checked, DNS pinned. Public HTML metadata survives browser failures. `attempts` retain original/resolved/canonical URLs, stage diagnostics, timing and public raw records. Missing fields use null; source/context cards can have UNKNOWN type when reply hierarchy cannot be verified. Manual metadata/media corrections never replace rawExtraction. CDN URLs can expire. No credential or login is used. STUDIO_BROWSER can point to an existing browser; no automatic download occurs.

API responses use the existing `{success,data}` envelope. Humans and agents use the same operations:

- POST `/api/studio/sessions`: create.
- GET `/api/studio/sessions`: list.
- GET `/api/studio/sessions/:id`: load full session.
- PUT `/api/studio/sessions/:id`: `{revision,title,items}`. Item patches accept only ID, selected, displayText and spokenText, in desired order. Originals/source IDs remain server-owned. Stale revision returns 409.
- PUT same route: `{revision,manual:{text,author,comments,url?}}`; comments are separated by newlines.
- POST `/api/studio/sessions/:id/fetch`: `{revision,urls}`; 1–5 canonical HTTPS Threads post URLs. Explicit request only. Failed extraction is persisted as ERROR with visible messages; successful URLs are retained.

Only one mutation/extraction is admitted at a time. No background jobs, AI, TTS, database, Discord or publishing modules are imported. Controlled scraper requests are restricted to HTTPS Threads/Meta CDN hostnames. Browser/model downloads are not part of Studio startup.

`StudioSession.project` uses VideoProject v1; original posts/comments and candidates are separate from editable StudioItems. Stable source references, revision and text locks support future storyboard generation. The editor boundary is VideoPreviewProps for the existing SeriousTimelinePreview and @remotion/player. Script/Voice/Editor/Render/Publish are explicitly unimplemented in UI-01.

Current limits: local single-process storage; no authentication, deletion UI, undo history, batch JSON import, automatic source refresh, or production rendering. Media references are shown as text; remote media is not fetched by the UI. Manual imports without URLs use an empty canonicalUrl to indicate unavailable provenance. Live extraction requires separate approval and has not been used for UI-01 validation.
