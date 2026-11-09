// Isolated DATA04 synthetic runtime. No credentials, remote network, TTS, render or production routes.
const fs = require('node:fs'),
  p = require('node:path');
const backend = p.resolve(__dirname, '..');
if (!/Tiktok_Automation_data04[\\/]1_nest_backend$/.test(backend))
  throw Error('DATA04 dedicated worktree required');
if (
  fs.existsSync(p.join(backend, '.env')) ||
  fs.lstatSync(p.join(backend, '.studio-data')).isSymbolicLink()
)
  throw Error('Isolated credential-free runtime required');
const sandbox = p.resolve(
  backend,
  '../../Tiktok_Automation_data04_acceptance',
  new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid,
);
const cwd = p.join(sandbox, '1_nest_backend');
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
fs.writeFileSync(
  p.join(
    backend,
    '.studio-data/reports/data04',
    'isolation-' + process.pid + '.json',
  ),
  JSON.stringify(
    { mode: 'SYNTHETIC', cwd, store: p.join(cwd, '.studio-data') },
    null,
    2,
  ),
);
process.chdir(cwd);
for (const k of Object.keys(process.env))
  if (
    !/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|PATHEXT|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|SYSTEMDRIVE)$/i.test(
      k,
    )
  )
    delete process.env[k];
const audit = { mode: 'SYNTHETIC', discover: 0, enrich: 0, outboundBlocked: 0 };
const deny = () => {
  audit.outboundBlocked++;
  throw Error('DATA04_OUTBOUND_DISABLED');
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
  { collectEvidence } = require('../dist/data-engine/conversation-evidence');
const {
    TransformInterceptor,
  } = require('../dist/common/interceptors/transform.interceptor'),
  {
    HttpExceptionFilter,
  } = require('../dist/common/filters/http-exception.filter');
const { fixture, url } = require('./data04-fixture.cjs');
(async () => {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });
  const service = app.get(ConversationStudioService);
  service.engine = new ConversationEngine(service.data.engine, {
    execution: 'SYNTHETIC',
    discover: async () => {
      audit.discover++;
      const high = fixture().root,
        low = {
          ...fixture('ROOT_A').root,
          engagement: { likes: 1, replies: 1, reposts: 1, shares: null },
        };
      return [
        { url: low.url, post: low, observedOrder: 0 },
        { url: high.url, post: high, observedOrder: 1 },
      ];
    },
    enrich: async (target) => {
      audit.enrich++;
      const f = fixture(target === url('ROOT_A') ? 'ROOT_A' : 'ROOT_B');
      return collectEvidence(f.root, f.doc);
    },
  });
  app.use((req, res, next) => {
    if (req.path === '/data04-proof')
      return res.json({
        ...audit,
        credentialsPresent: Object.keys(process.env).some((k) =>
          /TOKEN|SECRET|PASSWORD|CREDENTIAL|DATABASE_URL|API_KEY/i.test(k),
        ),
      });
    if (
      !['GET', 'HEAD'].includes(req.method) &&
      !/^\/api\/studio\/data\/conversations\/(runs(?:\/[a-f0-9]{64}\/resume)?|collections\/[a-f0-9]{64}\/feedback)$/.test(
        req.path,
      )
    )
      return res.status(403).json({ error: 'DATA04_SYNTHETIC_ROUTE_ONLY' });
    if (/\/oauth\//.test(req.path)) return res.status(403).end();
    next();
  });
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(3102, '127.0.0.1');
  console.log('DATA04 SYNTHETIC READY pid=' + process.pid);
  process.on('SIGINT', () => void app.close().then(() => process.exit(0)));
  process.on('SIGTERM', () => void app.close().then(() => process.exit(0)));
})().catch((e) => {
  console.error('DATA04_START_FAILED', String(e.message).slice(0, 200));
  process.exitCode = 1;
});
