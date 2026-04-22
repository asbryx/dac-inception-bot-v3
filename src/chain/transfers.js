const { Wallet, parseEther } = require('ethers');
const { writeJson, readJson } = require('../config/files');
const { paths } = require('../config/paths');

function createChildWallets(count = 3) {
  const wallets = Array.from({ length: count }, () => {
    const wallet = Wallet.createRandom();
    return { address: wallet.address, privateKey: wallet.privateKey };
  });
  writeJson(paths.childWalletsFile, { updatedAt: new Date().toISOString(), wallets });
  return wallets;
}

function readChildWallets() {
  return readJson(paths.childWalletsFile, { wallets: [] }).wallets || [];
}

async function sendNative(signer, to, amount) {
  return signer.sendTransaction({ to, value: parseEther(String(amount)) });
}

module.exports = { createChildWallets, readChildWallets, sendNative };
