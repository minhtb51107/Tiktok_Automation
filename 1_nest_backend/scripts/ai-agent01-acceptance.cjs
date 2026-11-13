#!/usr/bin/env node
/* Bounded LIVE acceptance over persisted captures. No crawler/TTS/render/publish. */
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
const { HuggingFaceContentProvider } = require('../dist/data-engine/ai-provider');
const { AiContentEvaluator, AiResearchAgent } = require('../dist/data-engine/ai-content');

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const gnrtthPath = value('--gnrtth');
const browserReportPath = value('--browser-report');
const outputRoot = value('--output');
if (!args.includes('--confirm-inference') || !gnrtthPath || !browserReportPath || !outputRoot) {
  throw Error('AI_ACCEPTANCE_ARGUMENTS_INVALID');
}

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

async function main() {
  await fs.mkdir(outputRoot, { recursive: true });
  const gnrtthBytes = await fs.readFile(gnrtthPath);
  const browserBytes = await fs.readFile(browserReportPath);
  const gnrtth = JSON.parse(gnrtthBytes.toString('utf8'));
  const browser = JSON.parse(browserBytes.toString('utf8'));
  const pngkhatu = browser.captures.find(
    (capture) => capture?.root?.author?.handle === 'pngkhatu',
  );
  if (!pngkhatu || gnrtth?.root?.author?.handle !== 'gnrtth')
    throw Error('AI_ACCEPTANCE_CAPTURE_MISSING');
  if (gnrtth.root.provenance.synthetic || pngkhatu.root.provenance.synthetic)
    throw Error('AI_ACCEPTANCE_REAL_CAPTURE_REQUIRED');

  const data = new DataEngine(new DataStore(path.join(outputRoot, 'data-engine')));
  const provider = new HuggingFaceContentProvider({
    ...process.env,
    HUGGINGFACE_MODEL: 'Qwen/Qwen3-14B',
    HUGGINGFACE_PROVIDER: 'auto',
    HUGGINGFACE_REASONING_MODE: 'DISABLED',
    HUGGINGFACE_MAX_TOKENS: '2048',
    // Three schema-invalid requests were consumed by earlier acceptance attempts.
    HUGGINGFACE_REQUEST_BUDGET: '97',
    HUGGINGFACE_TOKEN_BUDGET: '204800',
    HUGGINGFACE_COST_BUDGET_USD: '0.47',
  });
  const collections = [gnrtth, pngkhatu];
  const startedAt = new Date().toISOString();
  const runId = hash({ kind: 'ai-agent01-acceptance', captures: [sha(gnrtthBytes), sha(browserBytes)] });
  const records = [];
  for (const collection of collections) {
    const id = hash({ runId, collection });
    const evaluation = evaluateConversation(collection, startedAt);
    const record = {
      schemaVersion: DATA_SCHEMA, version: CONVERSATION_VERSION, id, runId,
      collection, evaluation, sourceLink: null, rightsStatus: 'UNKNOWN',
      configHash: hash(CONVERSATION_CONFIG),
    };
    await data.store.write(`thread-collections/${id}.json`, record, true);
    records.push(record);
  }
  await data.store.write(`conversation-runs/${runId}.json`, {
    schemaVersion: DATA_SCHEMA, version: CONVERSATION_VERSION, id: runId,
    request: { requestId: 'ai-agent01-acceptance', limit: 2, urls: collections.map((row) => row.root.url) },
    configHash: hash({ aiAcceptance: 1 }), execution: 'LIVE', status: 'COMPLETED',
    stage: 'AI_ACCEPTANCE_PERSISTED_CAPTURE', startedAt, completedAt: new Date().toISOString(), elapsedMs: 0,
    candidates: null, ranking: null,
    captures: collections.map((collection) => ({ url: collection.root.url, collection })),
    results: records.map((record) => ({ url: record.collection.root.url, collectionId: record.id, evaluation: record.evaluation })),
    history: [{ at: startedAt, stage: 'AI_ACCEPTANCE_PERSISTED_CAPTURE', outcome: 'COMPLETED' }], error: null,
  }, true);

  const conversations = new ConversationEngine(data, {
    execution: 'LIVE',
    discover: async () => { throw Error('AI_ACCEPTANCE_CRAWLER_DISABLED'); },
    enrich: async () => { throw Error('AI_ACCEPTANCE_CRAWLER_DISABLED'); },
  });
  const evaluator = new AiContentEvaluator(data, provider);
  const assessments = [];
  for (const record of records) {
    assessments.push(await evaluator.evaluate({
      collectionId: record.id, collection: record.collection,
      style: 'SERIOUS', heuristic: record.evaluation,
    }));
  }
  const agent = new AiResearchAgent(data, conversations, evaluator, provider);
  const agentRun = await agent.run({
    requestId: 'ai-agent01-live-acceptance',
    instruction: 'So sánh hai cuộc thảo luận đã lưu, chọn nguồn phù hợp nhất và đề xuất Script DRAFT SERIOUS 65–90 giây. Không bịa nguồn, bình luận hoặc quan hệ parent.',
    style: 'SERIOUS', targetDurationSeconds: 75,
    collectionIds: records.map((record) => record.id),
  });
  if (agentRun.status !== 'WAITING_REVIEW' || !agentRun.proposal)
    throw Error(agentRun.error || 'AI_ACCEPTANCE_AGENT_FAILED');

  const report = {
    schemaVersion: 'ai-agent01-acceptance/1', execution: 'LIVE_HUGGING_FACE_PERSISTED_CAPTURES',
    startedAt, completedAt: new Date().toISOString(), provider: provider.config(),
    sourceCaptures: records.map((record, index) => ({
      collectionId: record.id, rootId: record.collection.root.id,
      author: record.collection.root.author.handle, url: record.collection.root.url,
      captureSha256: index === 0 ? sha(gnrtthBytes) : sha(browserBytes),
      heuristic: record.evaluation,
    })),
    assessments, agentRun, budget: provider.metrics(),
    invariants: {
      sourceMutation: false, approvalsChanged: false, crawlerInvoked: false,
      ttsInvoked: false, renderInvoked: false, publishingInvoked: false,
    },
  };
  await fs.writeFile(path.join(outputRoot, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({
    status: 'PASS', model: report.provider.model, assessments: assessments.map((row) => ({
      author: records.find((record) => record.id === row.collectionId).collection.root.author.handle,
      id: row.id, selected: row.selectedSourceIds.length, excluded: row.excludedSourceIds.length,
      feasibility: row.feasibility.status,
    })),
    agent: { status: agentRun.status, selectedCollectionId: agentRun.plan?.selectedCollectionId, toolCalls: agentRun.toolCalls.map((row) => row.tool), proposalId: agentRun.proposal.id },
    budget: report.budget,
  }));
}
main().catch((error) => {
  const safeCode = /^AI_[A-Z0-9_]+$/.test(error?.message || '')
    ? error.message
    : error instanceof SyntaxError
      ? 'AI_SCHEMA_JSON_INVALID'
      : 'AI_ACCEPTANCE_FAILED';
  process.stderr.write(JSON.stringify({
    status: 'FAIL', error: safeCode,
    providerDiagnostic: typeof error.providerDiagnostic === 'string' ? error.providerDiagnostic : null,
  }));
  process.exitCode = 1;
});
