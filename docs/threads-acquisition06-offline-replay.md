# THREADS-ACQUISITION-06 offline replay

## Decision

The saved THREADS-ACQUISITION-05D evidence does not contain an additional valid
reply node that the current adapter can recover. Four direct replies remain the
complete set of structured post nodes retained from that live response. No
network request was made for this audit and the adapter was not broadened from
an unobserved schema.

## Saved GraphQL structure

The accepted public `POST /api/graphql` response has payload hash
`78ac69f2a7b7caad52f2fab9a85f933380f219137c554f72af012de7c6d4fc36`.
Its retained structured projections are:

| Outer `direct_replies.edges` index | Retained `posts.edges` indexes | Post code | Author |
| ---: | --- | --- | --- |
| 0 | 0 | `DeJby5QI9d6` | `bbunbo.huee` |
| 1 | 0 | `DeJi4m0E7yI` | `toiladuadangthatnghiepne` |
| 2 | 0 | `DeJe6SOG8nn` | `vitconkieman` |
| 3 | 0 | `DeJnO5mCVL_` | `_89_tntc` |

The generic bounded walker traversed every retained object and array entry; its
diagnostic reports four post nodes for this response. There is no retained post
pointer matching `posts/edges/1` or later, no nested-reply post pointer, and no
fifth structured post node. All four nodes have complete IDs, codes, authors,
permalinks, bodies, and timestamps, and all four match a DOM identity.

The four nodes expose neither `parentPostId` nor `rootPostId`. Their verified
direct-root relationship is supplied by the exact named target container
`data.media.text_post_app_info.direct_replies`, then validated by the existing
`collectEvidence()` graph validator. Array position is not used as parent
evidence.

## What is not recoverable from the saved capture

Raw GraphQL bodies were intentionally not persisted. The artifact retains a
payload hash, safe field inventory, exact post pointers, and sanitized post
projections. It does not retain:

- the total number of empty or non-post `direct_replies.edges` wrappers;
- `page_info`, `has_next_page`, end cursor, or pagination cursor values;
- objects rejected before becoming a post projection because they lacked an
  exact ID, code, or author.

Consequently those values are `NOT_RECOVERABLE_FROM_SAVED_CAPTURE`. The
observed indexes prove at least four outer edges, not that the server had no
additional page. There is no evidence in the saved projection that the
`posts/edges/0/node` rule dropped another valid post, so it was not generalized
speculatively to nested indexes.

## Browser action evidence

The live trace used four actions and all four were bounded scrolls. No explicit
`LOAD_MORE` or `EXPAND_NESTED` control was found by the collector.

- Initial snapshot: 20 subject cards with full bodies.
- Action 1: no new identity.
- Action 2: four new subject identities and the structured direct-reply
  response.
- Actions 3 and 4: no new identity.

The final screenshot shows a Threads sign-in modal over the public conversation
surface. Therefore the saved evidence provides no permissible public pagination
action after the first structured page. A future run must stop if that gate is
present; it must not replay GraphQL requests, add cookies, or bypass login.

## Quality and duration

After replay through `collectEvidence()`, the collection contains four verified
replies and 19 unresolved DOM cards. Source Quality V2 automatically selects:

1. `DeJby5QI9d6` — score 78, practical QA-office experience.
2. `DeJi4m0E7yI` — score 82, qualification and salary trade-off.
3. `DeJe6SOG8nn` — score 73, concrete list of office roles and language value.

`DeJnO5mCVL_` scores 52 and remains `NEEDS_REVIEW`; it is not included merely
to increase duration. The selected material contains 188 estimated narration
tokens and is estimated at 39-54 seconds (`ESTIMATED_TEXT_ONLY`). The correct
result remains `NOT_ENOUGH_CONTENT`, with `continueDiscovery: true`. No Script
DRAFT meeting the 65-90 second target was created.

## Next authorized live collection

A future single-use authorization should exercise only public UI behavior:

1. Open and verify the exact canonical root, attaching the passive structured
   observer before navigation.
2. Capture the initial DOM, SSR, GraphQL collection shape, safe edge counts, and
   pagination-presence flags.
3. If an explicit public `view/load replies` control exists, activate it once
   and capture the resulting response. Do not click the reply composer.
4. If an explicit public nested-reply expansion exists, activate at most one and
   preserve its action/container reference.
5. Stop immediately on the observed sign-in modal, CAPTCHA, redirect, or access
   protection.

If no additional public action is available, this root remains
`NOT_ENOUGH_CONTENT`; discovery should move to the next candidate within a
separately approved discovery budget rather than padding or weakening quality.

