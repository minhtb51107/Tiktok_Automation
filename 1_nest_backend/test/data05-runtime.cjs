// Real Nest/atomic persistence; source and audio explicitly SYNTHETIC. No external network or inference.
const fs = require('node:fs'),
  p = require('node:path');
const backend = p.resolve(__dirname, '..');
if (
  !/Tiktok_Automation_data05[\\/]1_nest_backend$/.test(backend) ||
  fs.existsSync(p.join(backend, '.env'))
)
  throw Error('Credential-free DATA05 worktree required');
const sandbox = p.resolve(
    backend,
    '../../Tiktok_Automation_data05_acceptance',
    Date.now() + '-' + process.pid,
  ),
  cwd = p.join(sandbox, '1_nest_backend');
fs.mkdirSync(p.join(cwd, '.studio-data'), { recursive: true });
for (const f of [
  'studio/index.html',
  'studio-dist/app.js',
  'studio-dist/app.css',
]) {
  const target = p.join(sandbox, '2_Remotion_Video', f);
  fs.mkdirSync(p.dirname(target), { recursive: true });
  fs.copyFileSync(p.resolve(backend, '../2_Remotion_Video', f), target);
}
fs.mkdirSync(p.join(sandbox, '2_Remotion_Video/public'), { recursive: true });
process.chdir(cwd);
for (const k of Object.keys(process.env))
  if (
    !/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|PATHEXT|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|SYSTEMDRIVE)$/i.test(
      k,
    )
  )
    delete process.env[k];
const audit = {
  mode: 'SYNTHETIC',
  outboundBlocked: 0,
  fixtureAudioInjections: 0,
  mutations: [],
};
const deny = () => {
  audit.outboundBlocked++;
  throw Error('DATA05_OUTBOUND_DISABLED');
};
for (const proto of ['node:http', 'node:https']) {
  require(proto).request = deny;
  require(proto).get = deny;
}
global.fetch = deny;
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core'),
  { AppModule } = require('../dist/app.module');
const {
    ConversationStudioService,
  } = require('../dist/data-engine/conversation.controller'),
  { ConversationEngine } = require('../dist/data-engine/conversation-engine'),
  {
    EditorialStudioService,
  } = require('../dist/data-engine/editorial.controller'),
  { EditorialEngine } = require('../dist/data-engine/editorial-engine'),
  { DataStudioService } = require('../dist/data-engine/data.controller');
const {
    editorialFixture,
  } = require('../dist/data-engine/editorial-test.fixture'),
  { textHash } = require('../dist/studio/kokoro-runtime'),
  { buildStudioPreview } = require('../dist/video-pipeline/studio-preview');
const {
    TransformInterceptor,
  } = require('../dist/common/interceptors/transform.interceptor'),
  {
    HttpExceptionFilter,
  } = require('../dist/common/filters/http-exception.filter');
const manifest = JSON.parse(
  fs.readFileSync(
    p.join(backend, '.studio-data/reports/data05/audio-fixtures/manifest.json'),
  ),
);
(async () => {
  const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn'],
    }),
    data = app.get(DataStudioService),
    conversation = app.get(ConversationStudioService),
    editorial = app.get(EditorialStudioService),
    f = editorialFixture();
  conversation.engine = new ConversationEngine(data.engine, {
    execution: 'SYNTHETIC',
    discover: async () => [],
    enrich: async () => f.collection,
  });
  editorial.engine = new EditorialEngine(conversation.engine);
  const run = await conversation.engine.start({
    requestId: 'SYNTHETIC-BOOTSTRAP-SOURCE',
    urls: [f.collection.root.url],
  });
  app.use(require('express').json({ limit: '1mb' }));
  app.use(async (req, res, next) => {
    try {
      if (req.path === '/data05-proof')
        return res.json({
          ...audit,
          credentialsPresent: Object.keys(process.env).some((k) =>
            /TOKEN|SECRET|PASSWORD|CREDENTIAL|DATABASE_URL|API_KEY/i.test(k),
          ),
          collectionId: run.results[0].collectionId,
        });
      const audio = req.path.match(/^\/data05-fixture-audio\/(\d)$/);
      if (audio && req.method === 'GET') {
        const row = manifest.rows[Number(audio[1])];
        if (!row) return res.status(404).end();
        return res.sendFile(row.file, { dotfiles: 'allow' });
      }
      const inject = req.path.match(
        /^\/data05-fixture-audio\/([a-f0-9-]{36})$/,
      );
      if (inject && req.method === 'POST') {
        const jobs = await data.production.list();
        if (
          !jobs.some(
            (j) =>
              j.projectId === inject[1] &&
              j.status === 'SUCCEEDED' &&
              j.snapshot.editorial,
          )
        )
          return res.status(403).end();
        const s = await data.studio.load(inject[1]);
        if (s.items.length !== 5)
          return res
            .status(400)
            .json({ error: 'SYNTHETIC_FIVE_SCENES_EXPECTED' });
        const assetDir = p.join(cwd, '.studio-data/audio', s.id, 'assets');
        fs.mkdirSync(assetDir, { recursive: true });
        const linked = manifest.rows.map((row, index) => {
          const file = p.join(assetDir, 'fixture-' + index + '.wav');
          if (!fs.existsSync(file)) fs.linkSync(row.file, file);
          return file;
        });
        // Test declaration only. Never claim that Kokoro/model/runtime is installed or READY.
        s.voiceRuntime = {status:'BLOCKED_RUNTIME',python:'',packageVersion:null,imports:{},voices:[],declaredVoices:[{id:'my_yen',label:'TEST DATA · settings contract only'}],model:null,modelVersion:'SYNTHETIC_NOT_TTS',device:'none',gpuAvailable:null,ffmpeg:false,ffprobe:true,blockers:['SYNTHETIC tones only; inference is disabled'],checkedAt:new Date().toISOString()};
        s.voiceAssets = s.items.map((i, index) => ({
          id: 'fixture-audio-' + index,
          itemId: i.id,
          itemRevision: i.revision,
          textHash: textHash(i.spokenText),
          spokenText: i.spokenText,
          voice: i.voiceSettings.voice,
          speed: i.voiceSettings.speed,
          model: 'SYNTHETIC_TONE_NOT_TTS',
          modelVersion: 'TEST DATA',
          cacheKey: 'fixture-' + index,
          durationMs: manifest.rows[index].durationMs,
          durationEvidence: 'SYNTHETIC_FIXTURE',
          filePath: p.relative(p.join(cwd, '.studio-data'), linked[index]),
          uri: '/api/studio/sessions/' + s.id + '/audio/fixture-audio-' + index,
          createdAt: new Date().toISOString(),
          approvedAt: null,
          status: 'GENERATED',
          purpose: 'DRAFT',
          cacheHit: true,
        }));
        const built = buildStudioPreview(s);
        s.project = built.project;
        const saved = await data.studio.persist(s);
        audit.fixtureAudioInjections++;
        return res.json({
          sessionId: saved.id,
          fixture: true,
          narration: false,
          voiceApprovals: 0,
          totalFrames: saved.project.timeline.totalFrames,
        });
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        const safe =
          /^\/api\/studio\/data\/(?:editorial\/plans(?:\/[a-f0-9]{64}(?:\/project)?)?|editorial\/sessions\/[a-f0-9-]{36}\/approve-script|conversations\/collections\/[a-f0-9]{64}\/feedback|posts\/[a-f0-9]{64}\/(?:review|enqueue))$/.test(
            req.path,
          ) ||
          /^\/api\/studio\/sessions\/[a-f0-9-]{36}(?:\/editor|\/media)?$/.test(
            req.path,
          ) ||
          (/^\/api\/studio\/sessions\/[a-f0-9-]{36}\/voice\/[^/]+$/.test(req.path) && req.body?.action === 'SETTINGS') ||
          (/^\/api\/studio\/sessions\/[a-f0-9-]{36}\/jobs$/.test(req.path) &&
            req.body?.operation === 'editor/prepare');
        if (!safe)
          return res.status(403).json({ error: 'SYNTHETIC_TEST_SCOPE_ONLY' });
        audit.mutations.push({ method: req.method, path: req.path });
      }
      if (/\/oauth\//.test(req.path)) return res.status(403).end();
      next();
    } catch {
      res.status(500).json({ error: 'SYNTHETIC_RUNTIME_FAILURE' });
    }
  });
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(3103, '127.0.0.1');
  fs.writeFileSync(
    p.join(
      backend,
      '.studio-data/reports/data05',
      'isolation-' + process.pid + '.json',
    ),
    JSON.stringify(
      { cwd, store: p.join(cwd, '.studio-data'), mode: 'SYNTHETIC' },
      null,
      2,
    ),
  );
  console.log('DATA05 SYNTHETIC READY pid=' + process.pid);
  process.on('SIGINT', () => void app.close().then(() => process.exit(0)));
  process.on('SIGTERM', () => void app.close().then(() => process.exit(0)));
})().catch((e) => {
  console.error('DATA05_START_FAILED', String(e.message).slice(0, 200));
  process.exitCode = 1;
});
