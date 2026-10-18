const crypto = require('crypto');

const readline = require('readline');

const provided = process.argv[2];
const createHash = password => {
  if (!password || password.length < 12) {
    console.error('Password must contain at least 12 characters.');
    process.exitCode = 1;
    return;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  console.log(`scrypt$${salt}$${hash}`);
};

if (provided) createHash(provided);
else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  rl.question('Owner password (input is visible): ', answer => {
    rl.close();
    createHash(answer);
  });
}
