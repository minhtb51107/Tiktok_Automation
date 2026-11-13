// Start only if the configured local port is free. Never stops another process.
require('./load-local-env.cjs');
const fs = require('node:fs');
const localFile = require('node:path').resolve(__dirname, '../.studio-data/runtime.local.json');
if (fs.existsSync(localFile)) {
 const config = JSON.parse(fs.readFileSync(localFile, 'utf8').replace(/^\uFEFF/, ''));
 const allowed = ['STUDIO_PYTHON','STUDIO_KOKORO_SOURCE','STUDIO_KOKORO_MODEL','STUDIO_KOKORO_CONFIG','STUDIO_KOKORO_VOICE_DIR','STUDIO_TTS_DEVICE'];
 for (const name of Object.keys(config)) {
  if (!allowed.includes(name) || typeof config[name] !== 'string') throw Error('Invalid local runtime configuration field');
  process.env[name] ??= config[name];
 }
 console.log('Loaded ignored local Kokoro runtime settings (no inference at startup).');
}
const net=require('node:net');const {spawn}=require('node:child_process');const path=require('node:path');
const port=Number(process.env.PORT||3000);
const probe=net.createServer();probe.once('error',e=>{console.log(`Port ${port} is already in use (${e.code}). Check http://127.0.0.1:${port}/studio . No second backend started. Use Get-NetTCPConnection to inspect its owner.`);process.exitCode=1;});
probe.listen(port,'127.0.0.1',()=>probe.close(()=>{
 const child=spawn(process.execPath,[path.resolve(__dirname,'../dist/main.js')],{cwd:path.resolve(__dirname,'..'),stdio:'inherit'});
 process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill());child.on('exit',code=>{process.exitCode=code||0;});
}));
