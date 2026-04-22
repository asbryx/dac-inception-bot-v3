const { readJson, writeJson } = require('../config/files');
const { paths } = require('../config/paths');
const { nowIso } = require('../utils/time');

async function runCampaign(context, { loops = 1, intervalSeconds = 0, profile = 'balanced' } = {}) {
  const history = readJson(paths.campaignFile, { runs: [] });
  const results = [];
  for (let loop = 0; loop < loops; loop += 1) {
    const strategy = await context.services.strategy.execute({ profileName: profile });
    const tracking = await context.services.tracking.snapshot();
    results.push({ loop: loop + 1, strategy, tracking, updatedAt: nowIso() });
  }
  const next = { runs: [...history.runs, ...results] };
  if (JSON.stringify(next) !== JSON.stringify(history)) writeJson(paths.campaignFile, next);
  return { loops, results };
}

module.exports = { runCampaign };
