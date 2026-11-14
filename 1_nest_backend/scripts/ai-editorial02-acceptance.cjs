#!/usr/bin/env node
/* LIVE HF acceptance over persisted captures only. No crawler/TTS/render/publish. */
require('./load-local-env.cjs');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { DataStore } = require('../dist/data-engine/store');
const { DataEngine } = require('../dist/data-engine/engine');
const { ConversationEngine } = require('../dist/data-engine/conversation-engine');
const { evaluateConversation, CONVERSATION_CONFIG } = require('../dist/data-engine/conversation-quality');
const { CONVERSATION_VERSION } = require('../dist/data-engine/conversation-contracts');
const { DATA_SCHEMA } = require('../dist/data-engine/contracts');
const { hash } = require('../dist/data-engine/rules');
const { observedContextViews } = require('../dist/data-engine/conversation-context');
const { HuggingFaceContentProvider } = require('../dist/data-engine/ai-provider');
const { AiContentEvaluator, AiResearchAgent } = require('../dist/data-engine/ai-content');

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const capturePath = value('--capture');
const labelsPath = value('--labels');
const priorReportPath = value('--prior-report');
const baongocReportPath = value('--baongoc-report');
const outputRoot = value('--output');
if (!args.includes('--confirm-inference') || !capturePath || !labelsPath || !outputRoot)
  throw Error('AI_EDITORIAL02_ARGUMENTS_INVALID');
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function optionalJson(file) {
  if (!file) return null;
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function main() {
  await fs.mkdir(outputRoot, { recursive: true });
  const captureBytes = await fs.readFile(capturePath);
  const fullCollection = JSON.parse(captureBytes.toString('utf8'));
  if (fullCollection?.root?.author?.handle !== 'gnrtth' || fullCollection.root.provenance.synthetic)
    throw Error('AI_EDITORIAL02_REAL_CAPTURE_REQUIRED');
  const labels = JSON.parse(await fs.readFile(labelsPath, 'utf8'));
  const referenceIds = labels[fullCollection.root.id] || [];
  const fullViews = observedContextViews(fullCollection, 'SERIOUS');
  const referenceViews = fullViews.filter((row) => referenceIds.includes(row.id));
  const comparison = fullViews
    .filter((row) => !referenceIds.includes(row.id))
    .sort((a, b) => Number(a.recommended) - Number(b.recommended) || a.quality.score - b.quality.score)
    .slice(0, 4);
  const sample = [...referenceViews, ...comparison];
  if (referenceViews.length < 1 || sample.length < 2) throw Error('AI_EDITORIAL02_SAMPLE_UNAVAILABLE');
  const sampleUrls = new Set(sample.map((row) => row.url));
  const collection = structuredClone(fullCollection);
  collection.sourceCapture.contextCandidates = (collection.sourceCapture.contextCandidates || [])
    .filter((row) => sampleUrls.has(row.url));
  collection.unverified = collection.unverified.filter((row) => sampleUrls.has(row.url));
  collection.replies = collection.replies.filter((row) => sample.some((view) => view.id === row.id));
  collection.observedReplyCount = sample.length;
  collection.unverifiedCandidateCount = collection.unverified.length;
  collection.verifiedReplyCount = collection.replies.length;
  collection.warnings = [...collection.warnings, 'AI_EDITORIAL02_BOUNDED_EDITORIAL_SAMPLE'];
  const data = new DataEngine(new DataStore(path.join(outputRoot, 'data-engine')));
  const provider = new HuggingFaceContentProvider({
    ...process.env,
    HUGGINGFACE_MODEL: 'Qwen/Qwen3-14B',
    HUGGINGFACE_PROVIDER: 'auto',
    HUGGINGFACE_REASONING_MODE: 'DISABLED',
    HUGGINGFACE_MAX_TOKENS: '2048',
    // A prior full-v2 attempt stopped on schema validation. This bounded sample
    // reserves no more than 20 additional requests inside the original 100 cap.
    HUGGINGFACE_REQUEST_BUDGET: '20',
    HUGGINGFACE_TOKEN_BUDGET: '40960',
    HUGGINGFACE_COST_BUDGET_USD: '0.20',
  });
  const startedAt = new Date().toISOString();
  const runId = hash({ kind: 'ai-editorial02', capture: sha(captureBytes) });
  const collectionId = hash({ runId, collection });
  const evaluation = evaluateConversation(collection, startedAt);
  await data.store.write(`thread-collections/${collectionId}.json`, {
    schemaVersion: DATA_SCHEMA,
    version: CONVERSATION_VERSION,
    id: collectionId,
    runId,
    collection,
    evaluation,
    sourceLink: null,
    rightsStatus: 'UNKNOWN',
    configHash: hash(CONVERSATION_CONFIG),
  }, true);
  await data.store.write(`conversation-runs/${runId}.json`, {
    schemaVersion: DATA_SCHEMA,
    version: CONVERSATION_VERSION,
    id: runId,
    request: { requestId: 'ai-editorial02', limit: 1, urls: [collection.root.url] },
    configHash: hash({ aiEditorial02: 1 }),
    execution: 'LIVE',
    status: 'COMPLETED',
    stage: 'PERSISTED_CAPTURE_ONLY',
    startedAt,
    completedAt: startedAt,
    elapsedMs: 0,
    candidates: null,
    ranking: null,
    captures: [{ url: collection.root.url, collection }],
    results: [{ url: collection.root.url, collectionId, evaluation }],
    history: [{ at: startedAt, stage: 'PERSISTED_CAPTURE_ONLY', outcome: 'COMPLETED' }],
    error: null,
  }, true);
  const conversations = new ConversationEngine(data, {
    execution: 'LIVE',
    discover: async () => { throw Error('AI_EDITORIAL02_CRAWLER_DISABLED'); },
    enrich: async () => { throw Error('AI_EDITORIAL02_CRAWLER_DISABLED'); },
  });
  const evaluator = new AiContentEvaluator(data, provider);
  const assessment = await evaluator.evaluate({
    collectionId,
    collection,
    style: 'SERIOUS',
    heuristic: evaluation,
  });
  const actualIds = new Set(assessment.candidates.map((row) => row.sourceId));
  const validReferenceIds = referenceIds.filter((id) => actualIds.has(id));
  const aiSelected = new Set(assessment.selectedSourceIds);
  const reference = new Set(validReferenceIds);
  const overlap = [...aiSelected].filter((id) => reference.has(id));
  const agreement = {
    status: reference.size ? 'MEASURED_AGAINST_PERSISTED_EDITORIAL_REFERENCE_NOT_GROUND_TRUTH' : 'NOT_MEASURED',
    referenceSelected: [...reference],
    aiSelected: [...aiSelected],
    overlap,
    precision: aiSelected.size ? overlap.length / aiSelected.size : null,
    recall: reference.size ? overlap.length / reference.size : null,
  };
  const agent = new AiResearchAgent(data, conversations, evaluator, provider);
  const agentRun = await agent.run({
    requestId: 'ai-editorial02-agent',
    instruction: 'Đề xuất video SERIOUS 65–90 giây từ bài gốc và context chất lượng. Context quan sát phải giữ cảnh báo chưa xác minh parent; không bịa dữ kiện hoặc kéo dài bằng lặp lại.',
    style: 'SERIOUS',
    targetDurationSeconds: 75,
    collectionIds: [collectionId],
  });
  if (agentRun.status !== 'WAITING_REVIEW') throw Error(agentRun.error || 'AI_EDITORIAL02_AGENT_FAILED');
  const referenceSelection = {
    status: 'REFERENCE_ONLY_NOT_USER_APPROVAL',
    selectedSourceIds: validReferenceIds,
  };
  const observed = observedContextViews(collection, 'SERIOUS');
  const sourceMap = new Map(observed.map((row) => [row.id, row]));
  const integrity = assessment.candidates.every((row) => actualIds.has(row.sourceId));
  if (!integrity) throw Error('AI_EDITORIAL02_SOURCE_INTEGRITY');
  const prior = await optionalJson(priorReportPath);
  const baongoc = await optionalJson(baongocReportPath);
  const report = {
    schemaVersion: 'ai-editorial02-acceptance/1',
    execution: 'LIVE_HUGGING_FACE_PERSISTED_CAPTURE',
    startedAt,
    completedAt: new Date().toISOString(),
    source: {
      collectionId,
      rootId: collection.root.id,
      author: collection.root.author.handle,
      url: collection.root.url,
      captureSha256: sha(captureBytes),
      originalUnchanged: sha(captureBytes) === sha(await fs.readFile(capturePath)),
      sampling: {
        fullObservedContexts: fullViews.length,
        evaluatedContexts: sample.length,
        persistedEditorialReferences: referenceViews.map((row) => row.id),
        comparisonContexts: comparison.map((row) => row.id),
        limitation: 'LIVE v2 quality acceptance sample; all 26 contexts remain available in the immutable source capture.',
      },
    },
    assessment,
    agreement,
    heuristicComparison: assessment.candidates.map((row) => ({
      sourceId: row.sourceId,
      relationshipEvidence: row.relationshipEvidence,
      heuristic: sourceMap.get(row.sourceId)?.quality ?? null,
      ai: {
        disposition: row.disposition,
        editorialStatus: row.editorialStatus,
        relevance: row.relevance,
        usefulness: row.usefulness,
        quality: row.quality,
        risks: row.risks,
      },
    })),
    agentRun,
    referenceSelection,
    supportingCaptures: {
      pngkhatuPriorLiveAssessment: prior?.assessments?.find((row) => row.collectionId !== prior.agentRun?.plan?.selectedCollectionId) ?? null,
      baongocOfflineAvailability: baongoc ? {
        verdict: baongoc.verdict,
        rootId: baongoc.root?.id,
        author: baongoc.root?.author?.handle,
        observed: baongoc.collection?.observedReplyCount,
        verified: baongoc.collection?.verifiedReplyCount,
        note: 'Available read-only; no inference in this run to preserve the remaining request budget.',
      } : null,
    },
    budget: provider.metrics(),
    invariants: {
      sourceIntegrity: integrity,
      evidenceUpgraded: assessment.candidates.some((row) => row.relationshipEvidence === 'PARENT_VERIFIED' && !collection.replies.some((reply) => reply.id === row.sourceId)),
      productionApproved: false,
      crawlerInvoked: false,
      ttsInvoked: false,
      renderInvoked: false,
      publishingInvoked: false,
    },
  };
  await fs.writeFile(path.join(outputRoot, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({
    status: 'PASS',
    assessment: { selected: assessment.selectedSourceIds.length, excluded: assessment.excludedSourceIds.length, feasibility: assessment.feasibility.status },
    agreement,
    agentProposal: agentRun.proposal && { id: agentRun.proposal.id, duration: agentRun.proposal.estimatedDuration, gate: agentRun.proposal.durationGate },
    reviewedProposal: null,
    budget: report.budget,
  }));
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({
    status: 'FAIL',
    error: /^AI_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : error instanceof SyntaxError ? 'AI_SCHEMA_JSON_INVALID' : 'AI_EDITORIAL02_FAILED',
    providerDiagnostic: typeof error?.providerDiagnostic === 'string' ? error.providerDiagnostic : null,
  }));
  process.exitCode = 1;
});
