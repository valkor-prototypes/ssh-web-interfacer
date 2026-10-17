import readline from 'node:readline';
import { hashPassword } from '../server/auth.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

// Hide typed characters.
rl._writeToOutput = (s) => {
  if (s.includes('\n') || s.includes('\r') || s.startsWith('Password')) process.stdout.write(s);
};

rl.question('Password: ', (password) => {
  rl.close();
  if (password.length < 12) {
    console.error('\nPlease use at least 12 characters — this password guards a shell on your server.');
    process.exit(1);
  }
  console.log(`\nAdd this line to your .env:\n\nAPP_PASSWORD_HASH=${hashPassword(password)}\n`);
});
