import { spawn } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const repoDir = path.resolve(appDir, '..', '..');
const standaloneAppDir = path.join(appDir, '.next', 'standalone', 'apps', 'pwa');

const syncDir = (source, target) => {
  if (!existsSync(source)) {
    return;
  }

  rmSync(target, {
    force: true,
    recursive: true
  });

  cpSync(source, target, {
    dereference: true,
    force: true,
    recursive: true
  });
};

const resolveEnvPath = () => {
  if (process.env.DOTENV_CONFIG_PATH) {
    return process.env.DOTENV_CONFIG_PATH;
  }

  const candidates = [
    path.join(appDir, '.env'),
    path.join(repoDir, '.env')
  ];

  return candidates.find((candidate) => existsSync(candidate));
};

process.chdir(appDir);

const envPath = resolveEnvPath();

if (envPath) {
  const parsedEnv = parseDotenv(readFileSync(envPath));

  for (const [key, value] of Object.entries(parsedEnv)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

syncDir(path.join(appDir, '.next', 'static'), path.join(standaloneAppDir, '.next', 'static'));
syncDir(path.join(appDir, 'public'), path.join(standaloneAppDir, 'public'));

const child = spawn(
  process.execPath,
  ['server.js'],
  {
    cwd: standaloneAppDir,
    env: process.env,
    stdio: 'inherit'
  }
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

for (const event of ['SIGINT', 'SIGTERM']) {
  process.on(event, () => {
    child.kill(event);
  });
}
