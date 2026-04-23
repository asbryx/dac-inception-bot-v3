const os = require('os');
const path = require('path');

const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'dac-bot-v3');
const APP_CONFIG_FILE = process.env.DAC_CONFIG_PATH
  ? path.resolve(process.env.DAC_CONFIG_PATH)
  : path.join(process.cwd(), 'dac.config.json');

const paths = {
  configDir: CONFIG_DIR,
  appConfigFile: APP_CONFIG_FILE,
  strategyFile: path.join(CONFIG_DIR, 'strategy.json'),
  mintCacheFile: path.join(CONFIG_DIR, 'mint-status.json'),
  trackingFile: path.join(CONFIG_DIR, 'tracking.json'),
  campaignFile: path.join(CONFIG_DIR, 'campaign.json'),
  childWalletsFile: path.join(CONFIG_DIR, 'child-wallets.json'),
};

module.exports = { paths };
