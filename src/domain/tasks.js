const TASKS = [
  ['signin', 'Record sign in'],
  ['sync', 'Sync account state'],
  ['telegram', 'Telegram quest'],
  ['x_follow', 'X follow quest'],
];

function normalizeTaskResult(result) {
  const alreadyDone = result?._status === 400 || /already/i.test(result?.error || '');
  if (alreadyDone) return { success: true, alreadyDone: true, ...result };
  return { success: !result?.error, ...result };
}

module.exports = { TASKS, normalizeTaskResult };
