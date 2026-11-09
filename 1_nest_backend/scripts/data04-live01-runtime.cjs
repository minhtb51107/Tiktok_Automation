const fs = require('node:fs');
const path = require('node:path');

const backend = path.resolve(__dirname, '..');
const store = path.resolve(process.argv[2] || '');
const pilotRoot = path.resolve(
  backend,
  '../../Tiktok_Automation_data04_live01/GCp_ap7Nk/backend/.studio-data',
);
if (store !== pilotRoot || !fs.existsSync(path.join(store, 'data-engine')))
  throw Error('LIVE01_ISOLATED_STORE_REQUIRED');
if (fs.existsSync(path.join(path.dirname(store), '.env')))
  throw Error('LIVE01_CREDENTIAL_FILE_REJECTED');

for (const key of Object.keys(process.env))
  if (
    !/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|PATHEXT|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|SYSTEMDRIVE)$/i.test(
      key,
    )
  )
    delete process.env[key];
process.env.PORT = '3106';
process.env.STUDIO_DATA_ROOT = store;
process.env.STUDIO_DATA04_MEDIA_ROOT = path.join(store, 'conversation-media');
process.env.STUDIO_DATA04_LIVE_ENABLED = '0';

const deny = () => {
  throw Error('LIVE01_RUNTIME_OUTBOUND_DISABLED');
};
for (const moduleName of ['node:http', 'node:https']) {
  const module = require(moduleName);
  module.request = deny;
  module.get = deny;
}
global.fetch = deny;

require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const {
  TransformInterceptor,
} = require('../dist/common/interceptors/transform.interceptor');
const {
  HttpExceptionFilter,
} = require('../dist/common/filters/http-exception.filter');

(async () => {
  process.chdir(backend);
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.use(require('express').json({ limit: '2mb' }));
  app.use((request, response, next) => {
    if (request.path === '/api/studio/runtime')
      return response.json({
        data: {
          mode: 'DATA04_LIVE01_COPY',
          port: 3106,
          scheduler: 'OFF',
          source: 'ONE_BOUNDED_PUBLIC_CAPTURE',
          outbound: 'DISABLED_AFTER_CAPTURE',
          credentialsPresent: false,
          capabilities: {
            review: true,
            crawler: false,
            tts: false,
            render: false,
            publish: false,
          },
        },
      });
    const review =
      request.method === 'POST' &&
      /^\/api\/studio\/data\/conversations\/collections\/[a-f0-9]{64}\/feedback$/.test(
        request.path,
      );
    if (!['GET', 'HEAD'].includes(request.method) && !review)
      return response.status(403).json({
        success: false,
        error: {
          code: 'DISABLED_BY_SAFETY',
          message:
            'LIVE-01 copy permits conversation feedback only; collection, production, TTS, render and publishing are disabled.',
        },
      });
    next();
  });
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(3106, '127.0.0.1');
  console.log(
    'DATA04 LIVE01 Studio READY http://127.0.0.1:3106/studio pid=' +
      process.pid,
  );
  async function close() {
    await app.close();
    process.exit(0);
  }
  process.on('SIGINT', () => void close());
  process.on('SIGTERM', () => void close());
})().catch((error) => {
  console.error('LIVE01_RUNTIME_FAILED', error.message);
  process.exitCode = 1;
});
