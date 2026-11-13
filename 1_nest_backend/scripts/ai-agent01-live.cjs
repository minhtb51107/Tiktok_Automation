#!/usr/bin/env node
/* Explicit, bounded AI-AGENT-01 acceptance. Requires a prior backend build. */
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
const capturePath = value('--capture');
const outputRoot = value('--output');
if (!args.includes('--confirm-live') || !capturePath || !outputRoot) {
  throw Error('Usage: --confirm-live --capture <collection.json> --output <isolated-dir>');
}
if (!process.env.HUGGINGFACE_API_KEY) throw Error('AI_BLOCKED_AUTH');

async function main() {
  await fs.mkdir(outputRoot, { recursive: true });
  const collection = JSON.parse(await fs.readFile(capturePath, 'utf8'));
  if (collection?.root?.provenance?.synthetic !== false) throw Error('AI_LIVE_CAPTURE_REQUIRED');
  const provider = new HuggingFaceContentProvider();
  const report = {
    schemaVersion: 'ai-agent01-live/1',
    execution: 'LIVE_HUGGING_FACE_ON_PERSISTED_CAPTURE',
    source: { id: collection.root.id, url: collection.root.url, captureSha256: crypto.createHash('sha256').update(await fs.readFile(capturePath)).digest('hex') },
    provider: provider.config(), health: null, assessment: null, agent: null,
    startedAt: new Date().toISOString(), completedAt: null, status: 'RUNNING', error: null,
  };
  try {
    const healthStart = Date.now();
    const health = await provider.completeJson({ system: 'Return exactly {"ok":true}. No prose.', input: { task: 'bounded_health_check' }, maxTokens: 24, temperature: 0 });
    const healthBody = JSON.parse(health.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    if (healthBody.ok !== true) throw Error('AI_HEALTH_SCHEMA_INVALID');
    report.health = { status: 'READY', model: health.model, route: health.providerRoute, latencyMs: Date.now() - healthStart, usage: health.usage };

    const data = new DataEngine(new DataStore(path.join(outputRoot, 'data-engine')));
    const runId = hash({ kind: 'ai-agent01-live', capture: report.source.captureSha256 });
    const collectionId = hash({ runId, collection });
    const evaluation = evaluateConversation(collection, new Date().toISOString());
    await data.store.write(`thread-collections/${collectionId}.json`, {
      schemaVersion: DATA_SCHEMA, version: CONVERSATION_VERSION, id: collectionId, runId,
      collection, evaluation, sourceLink: null, rightsStatus: 'UNKNOWN', configHash: hash(CONVERSATION_CONFIG),
    }, true);
    const conversations = new ConversationEngine(data, {
      execution: 'LIVE',
      discover: async () => { throw Error('AI_LIVE_CRAWLER_DISABLED'); },
      enrich: async () => { throw Error('AI_LIVE_CRAWLER_DISABLED'); },
    });
    const evaluator = new AiContentEvaluator(data, provider);
    const assessment = await evaluator.evaluate({ collectionId, collection, style: 'SERIOUS', heuristic: evaluation });
    report.assessment = assessment;
    const agent = new AiResearchAgent(data, conversations, evaluator, provider);
    report.agent = await agent.run({
      requestId: 'ai-agent01-live-once',
      instruction: 'Đánh giá capture đã lưu và đề xuất kịch bản DRAFT SERIOUS 65–90 giây; không bịa nguồn hoặc quan hệ.',
      style: 'SERIOUS', targetDurationSeconds: 75, collectionIds: [collectionId],
    });
    report.status = report.agent.status === 'WAITING_REVIEW' ? 'WAITING_REVIEW' : report.agent.status;
  } catch (error) {
    report.status = error.message === 'AI_BLOCKED_BILLING' ? 'BLOCKED_BILLING' : error.message === 'AI_BLOCKED_AUTH' ? 'BLOCKED_AUTH' : error.message === 'AI_RATE_LIMITED' ? 'RATE_LIMITED' : 'FAILED';
    report.error = /^AI_[A-Z0-9_]+$/.test(error.message) ? error.message : 'AI_LIVE_FAILED';
  } finally {
    report.completedAt = new Date().toISOString();
    await fs.writeFile(path.join(outputRoot, 'report.json'), JSON.stringify(report, null, 2));
  }
  process.stdout.write(JSON.stringify({ status: report.status, health: report.health?.status || null, assessmentId: report.assessment?.id || null, agentStatus: report.agent?.status || null, model: report.health?.model || report.provider.model, route: report.health?.route || report.provider.provider, usage: { health: report.health?.usage || null, assessment: report.assessment?.provider?.usage || null, agent: report.agent?.usage || null }, error: report.error }));
  if (!['WAITING_REVIEW', 'BLOCKED_BILLING', 'BLOCKED_AUTH', 'RATE_LIMITED'].includes(report.status)) process.exitCode = 1;
}
main().catch((error) => { process.stderr.write(/^AI_[A-Z0-9_]+$/.test(error.message) ? error.message : 'AI_LIVE_RUNNER_FAILED'); process.exitCode = 1; });
