// INTEGRATION-02 isolated runtime: SYNTHETIC/MOCK data only, port 3100.
// Refuses to start outside the integration worktree, with a .env present, or with
// any credential in the environment. The public crawler is replaced by a local
// synthetic source; no network, AI, TTS, render or publishing code is reachable.
const path = require('node:path');
const fs = require('node:fs');

const backend = path.resolve(__dirname, '..');
if (!/Tiktok_Automation_integration[\\/]1_nest_backend$/.test(backend))
  throw new Error('Synthetic runtime must run from the integration worktree');
if (fs.existsSync(path.join(backend, '.env'))) throw new Error('.env present; refusing to start');
process.chdir(backend);
for (const name of Object.keys(process.env))
  if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|THREADS|DISCORD|HUGGING|HF_/i.test(name) && !/^GIT_CONFIG/.test(name))
    delete process.env[name];
process.env.PORT = '3100';
for (const flag of ['ENABLE_DISCORD', 'ENABLE_WATCHER', 'ENABLE_AUTO_HUNTER', 'ENABLE_TIKTOK_UPLOADER'])
  process.env[flag] = 'false';

require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('../dist/app.module');
const { HttpExceptionFilter } = require('../dist/common/filters/http-exception.filter');
const { LoggingInterceptor } = require('../dist/common/interceptors/logging.interceptor');
const { TransformInterceptor } = require('../dist/common/interceptors/transform.interceptor');
const { DataStudioService } = require('../dist/data-engine/data.controller');
const { CrawlerStudioService } = require('../dist/data-engine/crawler.controller');
const { PublicCrawlerConsumer } = require('../dist/data-engine/crawler-consumer');

const dataDir = path.join(backend, '.studio-data');
const counters = path.join(dataDir, 'synthetic-counters.json');
const failOnce = path.join(dataDir, 'synthetic-fail-once');
const state = { scrape: 0, extract: 0, extractedUrls: [] };
const flush = () => fs.writeFileSync(counters, JSON.stringify(state));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BODY = {
  WORK: 'SYNTHETIC TEST DATA. Mình chia sẻ kinh nghiệm công việc trong công ty. Những người mới đi làm có gặp khó khăn khi trao đổi với đồng nghiệp không? Đây là một câu chuyện về cách học hỏi và tìm được công việc phù hợp với bản thân mình.',
  LIFE: 'SYNTHETIC TEST DATA. Cuộc sống ở thành phố đôi khi rất mệt mỏi. Mình muốn chia sẻ tâm sự về những thay đổi nhỏ giúp mỗi ngày nhẹ nhàng hơn, và hỏi mọi người đã tìm được cách nào cho riêng mình chưa?',
  FAMILY: 'SYNTHETIC TEST DATA. Gia đình mình có một thói quen cùng ăn tối vào cuối tuần. Mình chia sẻ trải nghiệm để những người đang bận rộn có thêm thời gian cho gia đình và người thân của họ.',
};

// Synthetic attempt shaped like the legacy public crawler's SourceAttempt.
function attempt(url) {
  const id = url.split('/post/')[1];
  const topic = /WORK/.test(id) ? 'WORK' : /LIFE/.test(id) ? 'LIFE' : 'FAMILY';
  return {
    originalUrl: url, resolvedUrl: url, canonicalUrl: url, status: 'SUCCESS', scope: 'TARGET_ONLY',
    matchedTargetId: id, matchMethod: 'DOM_PERMALINK', elapsedMs: 0, diagnostics: [], redirects: [],
    retrievedAt: new Date().toISOString(),
    records: [{
      text: BODY[topic] + ' [' + id + ']', author: 'SYNTHETIC TEST DATA', handle: 'synthetic_crawl_' + topic.toLowerCase(),
      avatar: null, createdAt: '2026-11-01T00:00:00Z', type: 'POST', parentReference: null, media: [],
      likeCount: 12, replyCount: 4, repostCount: 1, shareCount: null, provenance: { text: 'SYNTHETIC TEST DATA' },
    }],
  };
}

const crawlTopic = { 'chuyện đi làm': 'SYNCRAWLWORK', 'bài học cuộc sống': 'SYNCRAWLLIFE', 'chuyện gia đình': 'SYNCRAWLFAMILY' };
const scraper = {
  async scrapeForYouFeed(_s, o) {
    state.scrape++; flush();
    await sleep(1500);
    const q = new URL(o.url).searchParams.get('q');
    const code = crawlTopic[q] || 'SYNCRAWLWORK';
    return [1, 2].map((n) => ({ url: `https://www.threads.com/@synthetic_crawl/post/${code}${n}` }));
  },
};
const extract = async (url) => {
  state.extract++; state.extractedUrls.push(url); flush();
  if (fs.existsSync(failOnce)) {
    // File content = number of extractions allowed before one injected failure.
    const allowed = parseInt(fs.readFileSync(failOnce, 'utf8'), 10) || 0;
    if (allowed > 0) fs.writeFileSync(failOnce, String(allowed - 1));
    else { fs.unlinkSync(failOnce); throw new Error('SYNTHETIC injected extraction failure'); }
  }
  return attempt(url);
};

const seed = (id, handle, body, type, extra = {}) => ({
  sourcePlatform: 'THREADS', sourcePostId: id, sourceUrl: `https://www.threads.com/@${handle}/post/${id}`,
  author: { name: 'SYNTHETIC ' + handle, handle, avatarUrl: null }, originalBody: body, topic: 'WORK', itemType: type,
  parentReference: null, publishedAt: '2026-10-30T00:00:00Z', fetchedAt: '2026-11-03T00:00:00Z',
  engagement: { likes: 30, replies: 8, reposts: 2, shares: null }, fetch: { source: 'SYNTHETIC_FIXTURE', query: null },
  rawPayload: { synthetic: true, id }, provenance: { synthetic: true, identityEvidence: 'SYNTHETIC_FIXTURE' }, ...extra,
});

(async () => {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.rmSync(failOnce, { force: true });
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const data = app.get(DataStudioService, { strict: false });
  const crawler = app.get(CrawlerStudioService, { strict: false });
  crawler.consumer = new PublicCrawlerConsumer(data.engine, scraper, extract, 'MOCK');
  if (process.env.SYNTHETIC_SEED !== '0') {
    // Deterministic catalog: two posts by one author, an UNKNOWN target, a COMMENT.
    await data.engine.import([
      seed('SYNSAME00001', 'synthetic_author_a', BODY.WORK + ' Bài thứ nhất của tác giả A về lương và văn phòng.', 'POST'),
      seed('SYNSAME00002', 'synthetic_author_a', BODY.LIFE.replace('Cuộc sống', 'Công việc') + ' Bài thứ hai khác của cùng tác giả A.', 'POST'),
      seed('SYNUNKNOWN001', 'synthetic_author_b', BODY.FAMILY + ' Loại bài chưa xác định, cần người dùng xác nhận.', 'UNKNOWN'),
      seed('SYNCOMMENT001', 'synthetic_author_c', BODY.WORK + ' Đây là một bình luận tổng hợp về kinh nghiệm công việc.', 'COMMENT', { parentReference: 'SYNSAME00001' }),
    ], '2026-11-03T00:00:00Z');
  }
  await app.listen(3100, '127.0.0.1');
  console.log('SYNTHETIC RUNTIME READY http://127.0.0.1:3100/studio pid=' + process.pid);
})().catch((e) => { console.error('SYNTHETIC RUNTIME FAILED', e.message); process.exit(1); });
