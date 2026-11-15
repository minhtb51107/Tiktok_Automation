// Single-use THREADS-ACQUISITION-05 browser-only acceptance.
// Passive SSR/network observation only; no request replay/API/AI/provider/TTS/render/publish.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const cp = require('child_process');
const { createHash, randomUUID } = require('crypto');

const backend = path.resolve(__dirname, '..');
const output = path.join(
  backend,
  '.studio-data/reports/threads-acquisition05-live01',
);
const target = 'https://www.threads.com/@gnrtth/post/DeI-TuzEc_9';
const plan = {
  id: 'threads-acquisition05-live01',
  target,
  browserWorkers: 1,
  tabs: 1,
  totalBudgetMs: 180000,
  maxActions: 4,
  maxAdmittedRequests: 150,
  maxSubjectCards: 40,
  maxPermalinkDetails: 2,
  retry: false,
  passiveStructuredObservation: true,
  apify: false,
  qwen: false,
  tts: false,
  render: false,
  publishing: false,
};
const write = (name, value) =>
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
const sha = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
async function files(root, rows = []) {
  if (!fs.existsSync(root)) return rows;
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) await files(file, rows);
    else if (entry.isFile()) rows.push(file);
  }
  return rows;
}
async function manifest(root) {
  const rows = [];
  for (const file of (await files(root)).sort()) {
    const stat = await fsp.stat(file);
    rows.push({
      file: path.relative(root, file).replace(/\\/g, '/'),
      bytes: stat.size,
      sha256: sha(await fsp.readFile(file)),
    });
  }
  return { root, fileCount: rows.length, hash: sha(rows), rows };
}
const resourceAudit = () =>
  JSON.parse(
    cp.execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        path.join(__dirname, 'studio-resource-audit.ps1'),
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 25000 },
    ),
  );

if (process.argv[2] !== 'run') {
  console.log(
    JSON.stringify(
      {
        mode: 'PLAN_ONLY_NO_NETWORK',
        plan,
        attemptExists: fs.existsSync(path.join(output, 'attempt.json')),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  if (fs.existsSync(path.join(output, 'attempt.json')))
    throw Error('THREADS_ACQUISITION05_ATTEMPT_ALREADY_CONSUMED');
  if (process.env.THREADS_ACQUISITION05_APPROVED !== target)
    throw Error('THREADS_ACQUISITION05_EXACT_TARGET_AUTHORIZATION_REQUIRED');

  const beforeResources = resourceAudit();
  write('resource-before.json', beforeResources);
  const reserve =
    beforeResources.commitLimitMiB - beforeResources.commitUsedMiB;
  if (beforeResources.availableMiB < 256 || reserve < 512)
    throw Error('THREADS_ACQUISITION05_RESOURCE_PREFLIGHT_STOP');
  if (
    beforeResources.workers.some((worker) =>
      ['RENDER_WORKER', 'KOKORO_WORKER', 'COLLECTOR_WORKER'].includes(
        worker.role,
      ),
    )
  )
    throw Error('THREADS_ACQUISITION05_CONFLICTING_WORKER');

  const production = path.resolve(
    backend,
    '../../Tiktok_Automation/1_nest_backend/.studio-data',
  );
  const productionBefore = await manifest(production);
  write('production-before.json', productionBefore);
  const lock = path.join(backend, '.threads-acquisition05.lock');
  const token = randomUUID();
  fs.writeFileSync(
    lock,
    JSON.stringify({ pid: process.pid, token, purpose: plan.id }),
    { flag: 'wx' },
  );
  const report = {
    plan,
    status: 'RUNNING',
    execution: 'LIVE_BROWSER_ONLY_NOT_REPLAY',
    startedAt: new Date().toISOString(),
    visits: [],
    error: null,
  };
  try {
    for (const key of Object.keys(process.env))
      if (
        !/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC|PATHEXT|STUDIO_PYTHON|STUDIO_BROWSER)$/i.test(
          key,
        )
      )
        delete process.env[key];
    process.env.STUDIO_DATA_ROOT = path.join(output, 'studio-store');
    process.env.STUDIO_DATA04_MEDIA_ROOT = path.join(output, 'media');
    write('attempt.json', {
      plan,
      authorizationSource: 'USER_THREADS_ACQUISITION05_LIVE_ACCEPTANCE',
      at: report.startedAt,
      pid: process.pid,
      retries: 0,
    });

    const {
      enrichConversation,
    } = require('../dist/data-engine/conversation-public');
    const evidence = async (page, snapshot) => {
      write('browser-evidence.json', {
        ...snapshot,
        capturedAt: new Date().toISOString(),
        classification: 'SANITIZED_PUBLIC_BROWSER_EVIDENCE',
        credentialsCaptured: false,
        cookiesCaptured: false,
        authorizationHeadersCaptured: false,
        rawStructuredPayloadsPersisted: false,
      });
      await page.screenshot({
        path: path.join(output, 'conversation-surface.png'),
        type: 'png',
        captureBeyondViewport: false,
      });
    };
    const collection = await enrichConversation(
      target,
      (event) => {
        report.visits.push(event);
        write('report.json', report);
      },
      evidence,
      plan.totalBudgetMs,
    );
    write('collection.json', collection);

    const {
      sourceQualityAdapter,
    } = require('../dist/data-engine/conversation-extraction-v2');
    const normalized = sourceQualityAdapter(collection, 'SERIOUS');
    write('normalized.json', normalized);
    const diagnostics = collection.structuredEvidence?.diagnostics ?? [];
    const structuredPosts = collection.structuredEvidence?.posts ?? [];
    const fields = [
      ...new Set(diagnostics.flatMap((row) => row.observedFieldNames)),
    ].sort();
    const relationships = [
      ...new Set(diagnostics.flatMap((row) => row.relationshipFields)),
    ].sort();
    const verifiedStructured = (collection.replies ?? []).filter(
      (reply) => reply.evidence?.kind === 'STRUCTURED_PUBLIC_PARENT',
    );
    report.metrics = {
      ssrPayloads: diagnostics.filter((row) => row.source === 'SSR').length,
      networkJsonPayloads: diagnostics.filter((row) => row.source === 'NETWORK')
        .length,
      structuredPostNodes: structuredPosts.length,
      domIdentityMatches: collection.structuredEvidence?.domMatches ?? 0,
      observedFieldNames: fields,
      relationshipFieldNames: relationships,
      structuredConflicts: collection.structuredEvidence?.conflicts ?? [],
      subjectCards: collection.observationSummary?.subjectPermalinks ?? 0,
      fullCards: collection.observationSummary?.materializedCards ?? 0,
      verifiedReplies: collection.verifiedReplyCount,
      verifiedStructuredReplies: verifiedStructured.length,
      relatedRecommended: normalized.counts.related,
      unknown: normalized.counts.unknown,
      incomplete: normalized.counts.incompleteObservations,
      missingBody: normalized.counts.missingBody,
      qualitySelected: normalized.automation.selectedVerifiedReplyIds.length,
      candidateStatus: normalized.automation.candidateStatus,
      durationEstimate: normalized.automation.durationEstimate,
    };

    const { DataStore } = require('../dist/data-engine/store');
    const { DataEngine } = require('../dist/data-engine/engine');
    const {
      ConversationEngine,
    } = require('../dist/data-engine/conversation-engine');
    const data = new DataEngine(new DataStore());
    const engine = new ConversationEngine(data, {
      execution: 'LIVE',
      discover: async () => {
        throw Error('DISCOVERY_NOT_ALLOWED');
      },
      enrich: async (url) => {
        if (url !== target) throw Error('TARGET_MISMATCH');
        return collection;
      },
    });
    const run = await engine.start({
      requestId: plan.id,
      urls: [target],
      limit: 1,
      priority: 'HOT',
      minInteractions: 0,
    });
    if (run.status !== 'COMPLETED' || run.results.length !== 1)
      throw Error(run.error || 'THREADS_ACQUISITION05_PERSISTENCE_FAILED');
    const reopened = await engine.collection(run.results[0].collectionId);
    report.persistence = {
      runId: run.id,
      collectionId: run.results[0].collectionId,
      store: 'ISOLATED_SANDBOX',
      reopenPassed: reopened.collection.root.url === target,
      review: await engine.review(run.results[0].collectionId),
    };
    report.status = verifiedStructured.length
      ? 'PASS_LIVE_STRUCTURED_RELATIONSHIPS'
      : diagnostics.length
        ? 'PARTIAL_NO_STRUCTURED_PARENT_EVIDENCE'
        : 'PARTIAL_STRUCTURED_SOURCE_UNAVAILABLE';
  } catch (error) {
    report.status = 'FAILED_NO_RETRY';
    report.error = /^[A-Z0-9_: -]+$/u.test(error?.message ?? '')
      ? error.message
      : 'THREADS_ACQUISITION05_FAILED';
  } finally {
    report.completedAt = new Date().toISOString();
    report.elapsedMs =
      Date.parse(report.completedAt) - Date.parse(report.startedAt);
    report.resourceAfter = resourceAudit();
    const productionAfter = await manifest(production);
    write('production-after.json', productionAfter);
    report.productionPreserved = productionBefore.hash === productionAfter.hash;
    report.productionHashBefore = productionBefore.hash;
    report.productionHashAfter = productionAfter.hash;
    const lease = JSON.parse(fs.readFileSync(lock, 'utf8'));
    if (lease.pid === process.pid && lease.token === token) fs.unlinkSync(lock);
    write('report.json', report);
    console.log(
      JSON.stringify(
        {
          status: report.status,
          error: report.error,
          metrics: report.metrics ?? null,
          persistence: report.persistence ?? null,
          elapsedMs: report.elapsedMs,
          productionPreserved: report.productionPreserved,
          visits: report.visits.map((visit) => ({
            outcome: visit.outcome,
            admittedRequests: visit.requestTelemetry?.admittedRequests,
            interceptionEvents: visit.requestTelemetry?.interceptionEvents,
            actions: visit.interactionActions,
            minimumAvailableMiB: visit.minimumAvailableMiB,
            cleanupVerified: visit.resources?.cleanupVerified,
          })),
        },
        null,
        2,
      ),
    );
  }
})().catch((error) => {
  console.error(
    /^[A-Z0-9_]+$/u.test(error?.message ?? '')
      ? error.message
      : 'THREADS_ACQUISITION05_PREFLIGHT_FAILED_NO_ATTEMPT',
  );
  process.exitCode = 1;
});
