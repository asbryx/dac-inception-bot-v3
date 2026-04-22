const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStrategyPlan } = require('../src/domain/strategy');

test('strategy plan generates once without duplicate normal run branch', () => {
  const plan = buildStrategyPlan({ dacc: '1.5' }, 'balanced');
  assert.ok(plan.actions.length >= 1);
  assert.equal(plan.actions.filter((action) => action.type === 'tx-grind').length, 1);
});
