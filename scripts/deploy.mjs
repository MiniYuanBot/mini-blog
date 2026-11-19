/** Optional SSH deployment. Reuses the old project's release/symlink design,
 * without note imports, copied credentials, or arbitrary remote hooks.
 * The live link changes only after a complete upload and extraction.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

export function validateConfig(raw) {
  const config = { user: 'deploy', port: 22, liveLink: 'dist', ...raw };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(config.host || '')) throw new Error('host must be a hostname or IPv4 address.');
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(config.user)) throw new Error('user must be a valid SSH username.');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('port must be an integer between 1 and 65535.');
  if (typeof config.remoteDir !== 'string' || !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)+$/.test(config.remoteDir) || posix.normalize(config.remoteDir) !== config.remoteDir) {
    throw new Error('remoteDir must be an absolute directory such as /var/www/miniyuan-blog, with no spaces or traversal segments.');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(config.liveLink) || ['releases', 'previous'].includes(config.liveLink)) throw new Error('liveLink must be a simple filename other than releases or previous.');
  if (config.identityFile !== undefined && (typeof config.identityFile !== 'string' || !config.identityFile.trim())) throw new Error('identityFile must be a non-empty path.');
  for (const key of Object.keys(raw)) if (!['host', 'user', 'port', 'identityFile', 'remoteDir', 'liveLink'].includes(key)) throw new Error(`Unsupported deployment setting: ${key}`);
  return config;
}

export function releaseScript(config, release, rollback = false) {
  const base = config.remoteDir;
  const current = `${base}/${config.liveLink}`;
  const previous = `${base}/previous`;
  const releases = `${base}/releases`;
  const lock = `${base}/.deploy-lock`;
  const temporary = `${current}.next-${release}`;
  const priorTemporary = `${previous}.next-${release}`;
  const lines = [
    'set -eu',
    `mkdir ${quote(lock)} || { echo 'Another deployment holds the lock.' >&2; exit 1; }`,
    `trap ${quote(`rmdir ${quote(lock)}`)} EXIT`,
    "trap 'exit 1' HUP INT TERM",
    `current=${quote(current)}`,
    `previous=${quote(previous)}`,
    `releases=${quote(releases)}`,
    'valid_release() { case "$1" in "$releases"/*) suffix=${1#"$releases"/}; case "$suffix" in ""|*[!a-zA-Z0-9_-]*) return 1 ;; *) return 0 ;; esac ;; *) return 1 ;; esac; }',
    'old=""',
    'if [ -L "$current" ]; then old=$(readlink -f "$current"); valid_release "$old" || { echo "Live symlink must point to one release directory." >&2; exit 1; }; elif [ -e "$current" ]; then echo "Live path must be absent or a release symlink; refusing to replace an existing directory." >&2; exit 1; fi',
  ];
  if (rollback) {
    lines.push(
      '[ -n "$old" ] && [ -L "$previous" ] || { echo "No previous release is available." >&2; exit 1; }',
      'next=$(readlink -f "$previous")',
      'valid_release "$next" || { echo "Previous symlink must point to one release directory." >&2; exit 1; }',
      '[ -f "$next/index.html" ] || { echo "Previous release is incomplete." >&2; exit 1; }',
    );
  } else {
    const directory = `${releases}/${release}`;
    lines.push(
      `next=${quote(directory)}`,
      `tar -xzf ${quote(`${directory}/upload.tar.gz`)} -C "$next"`,
      '[ -f "$next/index.html" ] || { echo "Release is incomplete." >&2; exit 1; }',
      `rm -f ${quote(`${directory}/upload.tar.gz`)}`,
    );
  }
  lines.push(
    `if [ -n "$old" ]; then ln -s "$old" ${quote(priorTemporary)}; mv -Tf ${quote(priorTemporary)} "$previous"; fi`,
    `ln -s "$next" ${quote(temporary)}`,
    `mv -Tf ${quote(temporary)} "$current"`,
    'echo "Now serving $next"',
  );
  return lines.join('\n');
}

export function main(args = process.argv.slice(2), root = process.cwd()) {
  if (args.includes('--help')) {
    console.log('Usage: pnpm ship [--dry-run] [--skip-build | --rollback] [--config PATH]\n\nRequires deploy.config.json, SSH, SCP, tar, and a Linux server with GNU mv.\n--dry-run prints the complete plan without executing commands or creating files.\n--rollback swaps the current and previous releases. No releases are deleted.');
    return;
  }
  const flags = new Set();
  let configName = 'deploy.config.json';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--config') {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('--config requires a file path.');
      configName = args[++index];
    } else if (['--dry-run', '--skip-build', '--rollback'].includes(arg)) flags.add(arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (flags.has('--skip-build') && flags.has('--rollback')) throw new Error('--skip-build and --rollback cannot be used together.');
  const configPath = resolve(root, configName);
  if (!existsSync(configPath)) throw new Error('Deployment config not found. Copy deploy.config.example.json to deploy.config.json and fill in your server details.');
  const config = validateConfig(JSON.parse(readFileSync(configPath, 'utf8')));
  const dryRun = flags.has('--dry-run');
  const release = `${new Date().toISOString().replace(/[^0-9]/g, '')}-${randomBytes(3).toString('hex')}`;
  const target = `${config.user}@${config.host}`;
  const identity = config.identityFile?.startsWith('~/') ? join(homedir(), config.identityFile.slice(2)) : config.identityFile;
  const sshOptions = ['-p', String(config.port), '-o', 'BatchMode=yes', ...(identity ? ['-i', identity] : [])];
  const scpOptions = ['-P', String(config.port), '-o', 'BatchMode=yes', ...(identity ? ['-i', identity] : [])];
  function run(command, commandArgs, options = {}) {
    console.log(`$ ${command} ${commandArgs.map((arg) => /\s/.test(arg) ? JSON.stringify(arg) : arg).join(' ')}`);
    if (dryRun) return;
    const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} exited with ${result.status}.`);
  }
  function packageScript(script) {
    const execPath = process.env.npm_execpath;
    if (execPath && existsSync(execPath)) {
      // JavaScript-based package manager
      if (/\.(js|cjs|mjs)$/i.test(execPath)) {
        run(process.execPath, [execPath, 'run', script]);
        return;
      }
      // Native Windows executable
      if (/\.exe$/i.test(execPath)) {
        run(execPath, ['run', script]);
        return;
      }
    }
    // Fallback
    run('pnpm', ['run', script], {
      shell: process.platform === 'win32',
    });
  }
  const ssh = (script) => run('ssh', [...sshOptions, target, script]);
  if (flags.has('--rollback')) {
    ssh(releaseScript(config, release, true));
    return;
  }
  if (!flags.has('--skip-build')) {
    for (const script of ['check', 'test', 'build']) packageScript(script);
  }
  packageScript('check:links');
  if (!dryRun && !existsSync(join(root, 'dist/index.html'))) throw new Error('dist/index.html is missing. Run pnpm build first.');
  const archive = 'dist-upload.tar.gz';
  try {
    run('tar', ['-czf', archive, '-C', 'dist', '.']);
    const directory = `${config.remoteDir}/releases/${release}`;
    ssh(`mkdir -p ${quote(directory)}`);
    // A relative local filename avoids scp interpreting a Windows drive as a host.
    run('scp', [...scpOptions, archive, `${target}:${directory}/upload.tar.gz`]);
    ssh(releaseScript(config, release));
    console.log(dryRun ? 'Dry run complete. Nothing was changed.' : 'Deployment complete. Use pnpm ship --rollback to switch back.');
  } finally {
    if (!dryRun && existsSync(join(root, archive))) unlinkSync(join(root, archive));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
