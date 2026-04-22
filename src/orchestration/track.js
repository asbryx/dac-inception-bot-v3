const { readJson, writeJson } = require('../config/files');
const { paths } = require('../config/paths');

async function snapshotTracking(context) {
  const status = await context.services.statusService.fetchNormalizedStatus();
  const previous = readJson(paths.trackingFile, { rows: [] });
  const next = { rows: [...previous.rows, status] };
  if (JSON.stringify(next) !== JSON.stringify(previous)) writeJson(paths.trackingFile, next);
  return status;
}

module.exports = { snapshotTracking };
