# THREADS-ACQUISITION-05D live acceptance

## Scope

Exactly one authorized browser-only collection was run against
`https://www.threads.com/@gnrtth/post/DeI-TuzEc_9`. It used one browser worker,
four actions, no retry, and did not invoke Apify, Qwen, TTS, rendering, or
publishing. The original LIVE capture is retained unchanged under
`1_nest_backend/.studio-data/reports/threads-acquisition05d-live01`.

## Live evidence

- Collection time: 27.584 seconds.
- Public DOM: 24 subject cards, 23 cards with full bodies.
- SSR: 30 `data-sjs` payloads. They remained root-only during this run.
- Network: three JSON-compatible payloads, including two completed HTTP 200
  `POST /api/graphql` responses with `Content-Type: text/javascript`.
- The second GraphQL response contained the observed `direct_replies` field.
- Structured extraction found five post nodes and matched all five identities
  to DOM cards: the root plus four direct-reply nodes.
- Minimum available physical memory was 1,784.17 MiB. Peak sampled browser RSS
  was 725.80 MiB. Browser cleanup completed with no remaining owned process.

The live runner initially classified the four reply nodes as unknown. The
existing adapter only accepted a `direct_replies` container when the same
payload also contained a root post object. The observed GraphQL response instead
placed these nodes at these exact paths without duplicating the root object:

`/data/media/text_post_app_info/direct_replies/edges/{index}/node/posts/edges/0/node`

The minimal adapter change recognizes only this observed public GraphQL shape,
ties the named target `direct_replies` container to the already resolved exact
root, and sends the resulting candidates through the existing
`collectEvidence()` graph validator. It does not infer parentage from array
order, author, text similarity, or general page co-location.

## Verified replay of the saved live payload

The saved structured observations were replayed offline after the adapter fix;
the browser was not run a second time. `collectEvidence()` verified four direct
root relationships:

| Post ID | Author | Evidence |
| --- | --- | --- |
| `DeJby5QI9d6` | `bbunbo.huee` | `STRUCTURED_TARGET_DIRECT_REPLIES_CONTAINER` |
| `DeJi4m0E7yI` | `toiladuadangthatnghiepne` | `STRUCTURED_TARGET_DIRECT_REPLIES_CONTAINER` |
| `DeJe6SOG8nn` | `vitconkieman` | `STRUCTURED_TARGET_DIRECT_REPLIES_CONTAINER` |
| `DeJnO5mCVL_` | `_89_tntc` | `STRUCTURED_TARGET_DIRECT_REPLIES_CONTAINER` |

Resolved collection counts are 23 materialized cards, four verified replies,
and 19 unknown cards. No unknown card was promoted and no recommendation was
treated as a reply.

## Quality and video feasibility

Source Quality V2 recommended three verified replies (`DeJby5QI9d6`,
`DeJi4m0E7yI`, and `DeJe6SOG8nn`). `DeJnO5mCVL_` remains `NEEDS_REVIEW` because
its argument quality is uncertain.

The selected source material contains 188 estimated narration tokens and is
estimated at 39-54 seconds (the Studio presentation rounds this to 40-55
seconds). This is `ESTIMATED_TEXT_ONLY`, not measured audio. The result is
`NOT_ENOUGH_CONTENT` for the 65-90 second target, so no complete 60-second
Script DRAFT is claimed.

## Studio and persistence acceptance

- URL: `http://127.0.0.1:3118/studio?area=Discovery&step=Source`
- Isolated store: `threads-acquisition05d-live01/studio-store-resolved`
- Save/reopen: passed.
- Read-only browser reopen: four verified reply controls and 19 unknown cards.
- Copy report: 14,180 bytes and contains the root and verified reply identities.
- JSON export: 1,349,497 bytes.
- Markdown export: 14,180 bytes.
- No write request and no external request occurred during the read-only smoke.

## Preservation and verification

The production manifest remained 933 files with SHA-256
`6e5eb085406d8f2ef11ff172612c6f121f5d05094581b89305b4a958edefb047`
before and after the run. Targeted conversation regression passed 32/32 and the
backend build passed. Runtime captures, screenshots, downloads, and sandbox
stores remain ignored and are not committed.

## Artifact index

- Original collection: `collection.json`
- Resolved derived collection: `collection-resolved.json`
- Offline resolution summary: `offline-resolution.json`
- Sanitized browser evidence: `browser-evidence.json`
- Live report: `report.json`
- Studio verification: `studio-browser-verification.json`
- Studio screenshot: `studio-acceptance.png`

