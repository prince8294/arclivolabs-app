const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const backendRoot = path.resolve(__dirname, '..');
const envPath = path.join(backendRoot, '.env');
const envTemplatePath = path.join(backendRoot, '.env.example');

const readHidden = prompt =>
  new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      reject(new Error('Run this command in an interactive VS Code terminal.'));
      return;
    }

    const input = process.stdin;
    const output = process.stderr;
    const wasRaw = Boolean(input.isRaw);
    let value = '';
    let finished = false;

    const cleanup = () => {
      input.removeListener('data', onData);
      input.setRawMode(wasRaw);
      input.pause();
    };

    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      output.write('\n');
      cleanup();
      if (error) reject(error);
      else resolve(result);
    };

    const onData = chunk => {
      for (const character of String(chunk)) {
        if (character === '\u0003') {
          finish(new Error('Setup cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish(null, value);
          return;
        }
        if (character === '\u0008' || character === '\u007f') {
          value = value.slice(0, -1);
          continue;
        }
        if (character.charCodeAt(0) >= 32) value += character;
      }
    };

    output.write(prompt);
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });

const getEnvValue = (contents, key) => {
  const expression = new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`, 'm');
  const match = contents.match(expression);
  if (!match) return '';
  return match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
};

const setEnvValue = (contents, key, value) => {
  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  const expression = new RegExp(`^\\s*${key}\\s*=.*$`, 'gm');
  const replacement = `${key}=${value}`;

  if (expression.test(contents)) return contents.replace(expression, replacement);
  const separator = contents.length === 0 || contents.endsWith('\n') ? '' : newline;
  return `${contents}${separator}${replacement}${newline}`;
};

const createPasswordHash = async password => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
};

const writeEnvAtomically = contents => {
  const temporaryPath = `${envPath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    fs.renameSync(temporaryPath, envPath);
    try {
      fs.chmodSync(envPath, 0o600);
    } catch {
      // Windows ACLs are managed by the OS; .env is also excluded by .gitignore.
    }
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Preserve the original error.
    }
    throw error;
  }
};

const main = async () => {
  if (process.argv.length > 2) {
    throw new Error('Do not pass a password as a command argument; use the hidden prompt.');
  }

  const envExists = fs.existsSync(envPath);
  let contents = envExists
    ? fs.readFileSync(envPath, 'utf8')
    : fs.readFileSync(envTemplatePath, 'utf8');
  const isReset = Boolean(getEnvValue(contents, 'OWNER_PASSWORD_HASH'));

  process.stderr.write(
    isReset
      ? 'Resetting the owner password will sign out existing owner sessions.\n'
      : 'Configuring the initial owner password.\n'
  );

  const password = await readHidden('New owner password (12-256 characters, hidden): ');
  if (password.length < 12 || password.length > 256) {
    throw new Error('Password must contain between 12 and 256 characters.');
  }
  const confirmation = await readHidden('Confirm new owner password (hidden): ');
  const passwordBytes = Buffer.from(password);
  const confirmationBytes = Buffer.from(confirmation);
  const passwordsMatch =
    passwordBytes.length === confirmationBytes.length &&
    crypto.timingSafeEqual(passwordBytes, confirmationBytes);
  passwordBytes.fill(0);
  confirmationBytes.fill(0);
  if (!passwordsMatch) {
    throw new Error('Passwords do not match. No files were changed.');
  }

  const passwordHash = await createPasswordHash(password);
  contents = setEnvValue(contents, 'OWNER_PASSWORD_HASH', passwordHash);

  // Always rotate this key so a password reset also invalidates every issued session.
  contents = setEnvValue(contents, 'SESSION_SIGNING_KEY', crypto.randomBytes(48).toString('base64url'));

  let generatedEncryptionKey = false;
  if (!getEnvValue(contents, 'DATA_ENCRYPTION_KEY')) {
    contents = setEnvValue(contents, 'DATA_ENCRYPTION_KEY', crypto.randomBytes(32).toString('base64'));
    generatedEncryptionKey = true;
  }

  writeEnvAtomically(contents);

  process.stdout.write(`${isReset ? 'Owner password reset' : 'Owner authentication initialized'} in .env.\n`);
  process.stdout.write('The session signing key was rotated; existing sessions are invalid.\n');
  if (generatedEncryptionKey) {
    process.stdout.write('A data encryption key was created because none was configured.\n');
  }
  process.stdout.write('Restart the backend before signing in.\n');
};

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { createPasswordHash, getEnvValue, setEnvValue };
