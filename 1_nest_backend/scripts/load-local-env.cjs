const path = require('node:path');
const dotenv = require('dotenv');

const backendRoot = path.resolve(__dirname, '..');
const local = path.resolve(backendRoot, '.env');
const requested = process.env.DOTENV_CONFIG_PATH?.trim();
if (requested && path.resolve(requested) !== local) {
  throw Error('EXTERNAL_DOTENV_CONFIG_PATH_REJECTED');
}
const result = dotenv.config({ path: local, override: false, quiet: true });
if (result.error && result.error.code !== 'ENOENT') {
  throw Error('LOCAL_DOTENV_LOAD_FAILED');
}
module.exports = Object.freeze({
  path: local,
  exists: !result.error,
  huggingFaceCredential: process.env.HUGGINGFACE_API_KEY?.trim()
    ? 'present'
    : 'absent',
});
