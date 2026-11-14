#!/usr/bin/env node
/* One bounded Script DRAFT request from persisted LIVE assessment + editorial selection. */
require('./load-local-env.cjs');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { DataStore } = require('../dist/data-engine/store');
const { DataEngine } = require('../dist/data-engine/engine');
const { ConversationEngine } = require('../dist/data-engine/conversation-engine');
const { HuggingFaceContentProvider } = require('../dist/data-engine/ai-provider');
const { AiContentEvaluator, AiResearchAgent } = require('../dist/data-engine/ai-content');

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const storeRoot = value('--store');
const labelsPath = value('--labels');
const sourceCapturePath = value('--source-capture');
const outputRoot = value('--output');
if (!args.includes('--confirm-inference') || !storeRoot || !labelsPath || !sourceCapturePath || !outputRoot)
  throw Error('AI_EDITORIAL02_CANDIDATE_ARGUMENTS_INVALID');
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  await fs.mkdir(outputRoot, { recursive: true });
  const sourceBefore = await fs.readFile(sourceCapturePath);
  const labels = JSON.parse(await fs.readFile(labelsPath, 'utf8'));
  const data = new DataEngine(new DataStore(path.resolve(storeRoot)));
  const provider = new HuggingFaceContentProvider({
    ...process.env,
    HUGGINGFACE_MODEL: 'Qwen/Qwen3-14B',
    HUGGINGFACE_PROVIDER: 'auto',
    HUGGINGFACE_REASONING_MODE: 'DISABLED',
    HUGGINGFACE_MAX_TOKENS: '2048',
    // Recovery policy allows at most one final request after an externally
    // verified project-wide ledger check. This script never retries.
    HUGGINGFACE_REQUEST_BUDGET: '1',
    HUGGINGFACE_TOKEN_BUDGET: '2048',
    HUGGINGFACE_COST_BUDGET_USD: '0.05',
  });
  let assessment;
  for await (const row of data.store.rows('ai-assessments')) {
    const candidate = row.assessment;
    const collection = await data.store.read(`thread-collections/${candidate.collectionId}.json`);
    if (collection?.collection?.root?.author?.handle === 'gnrtth') {
      assessment = candidate;
      break;
    }
  }
  if (!assessment) throw Error('AI_EDITORIAL02_GNRTTH_ASSESSMENT_MISSING');
  const referenceIds = labels['DeI-TuzEc_9'] || [];
  const allowed = new Set(assessment.candidates.map((row) => row.sourceId));
  const selectedSourceIds = referenceIds.filter((id) => allowed.has(id));
  if (selectedSourceIds.length < 2) throw Error('AI_EDITORIAL02_REFERENCE_SELECTION_MISSING');
  const evaluator = new AiContentEvaluator(data, provider);
  const feedback = await evaluator.feedback(assessment.id);
  const approvedIds = [...(feedback?.selectedSourceIds ?? [])].sort();
  if (
    feedback?.decision !== 'ACCEPT' ||
    JSON.stringify(approvedIds) !== JSON.stringify([...selectedSourceIds].sort())
  )
    throw Error('AI_EXPLICIT_USER_EDITORIAL_SELECTION_REQUIRED');
  const conversations = new ConversationEngine(data, {
    execution: 'LIVE',
    discover: async () => { throw Error('AI_EDITORIAL02_CRAWLER_DISABLED'); },
    enrich: async () => { throw Error('AI_EDITORIAL02_CRAWLER_DISABLED'); },
  });
  const agent = new AiResearchAgent(data, conversations, evaluator, provider);
  const proposal = await agent.proposeReviewed(assessment.id, {
    requestId: 'ai-editorial02-final-candidate',
    expectedFeedbackRevision: feedback.revision,
    targetDurationSeconds: 75,
    instruction: 'Tạo Script DRAFT SERIOUS 65–90 giây đáng xem: hook, bối cảnh bài gốc, các trải nghiệm/góc nhìn đã chọn, phân tích chuyển ý nguyên tác và kết luận. Không bịa dữ kiện, không lặp lời, không nâng context thành parent-verified.',
  });
  const sourceAfter = await fs.readFile(sourceCapturePath);
  const report = {
    schemaVersion: 'ai-editorial02-reviewed-candidate/1',
    execution: 'LIVE_HUGGING_FACE_PERSISTED_SELECTION',
    assessmentId: assessment.id,
    assessmentVersion: assessment.schemaVersion,
    feedback,
    proposal,
    budget: provider.metrics(),
    sourceIntegrity: {
      beforeSha256: sha(sourceBefore),
      afterSha256: sha(sourceAfter),
      unchanged: sha(sourceBefore) === sha(sourceAfter),
    },
    limitations: [
      'Candidate quality uses the prior LIVE assessment plus an explicit persisted user editorial selection.',
      'AI Content Quality V2 LIVE schema acceptance remains PARTIAL.',
      'Duration is estimated from narration text and is not measured audio.',
      'Observed contexts remain unverified parent relationships and require human review.',
    ],
    invariants: {
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
    proposalId: proposal.id,
    selectedSources: selectedSourceIds,
    sections: proposal.sections.length,
    duration: proposal.estimatedDuration,
    durationGate: proposal.durationGate,
    warnings: proposal.warnings,
    budget: report.budget,
  }));
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({
    status: 'FAIL',
    error: /^AI_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : error instanceof SyntaxError ? 'AI_SCHEMA_JSON_INVALID' : 'AI_EDITORIAL02_CANDIDATE_FAILED',
    providerDiagnostic: typeof error?.providerDiagnostic === 'string' ? error.providerDiagnostic : null,
  }));
  process.exitCode = 1;
});
