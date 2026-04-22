const test = require('node:test');
const assert = require('node:assert/strict');
const { box } = require('../src/tui/renderer');
const { stripAnsi } = require('../src/tui/theme');

test('box wraps long lines instead of dumping one huge row', () => {
  const text = box('Wrap', ['this is a very long line that should wrap nicely across multiple rows inside the panel instead of becoming one messy line'], 50);
  const lines = text.split('\n');
  assert.ok(lines.length > 4);
  assert.ok(lines.every((line) => stripAnsi(line).length <= 50));
});
