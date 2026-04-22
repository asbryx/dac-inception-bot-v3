const readline = require('readline');

function prompt(question, { silent = false } = {}) {
  if (silent && process.stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const stdin = process.stdin;
      process.stdout.write(question);
      stdin.setRawMode(true);
      stdin.resume();
      let value = '';

      const cleanup = () => {
        stdin.setRawMode(false);
        stdin.removeListener('data', onData);
        rl.close();
      };

      const onData = (buffer) => {
        const key = buffer.toString();
        if (key === '\r' || key === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (key === '\u0003') {
          cleanup();
          process.exit(1);
        }
        if (key === '\u007f') {
          value = value.slice(0, -1);
          return;
        }
        value += key;
      };

      stdin.on('data', onData);
    });
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

module.exports = { prompt };
