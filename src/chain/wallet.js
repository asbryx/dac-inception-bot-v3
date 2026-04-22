const { Wallet } = require('ethers');
const { createProvider } = require('./provider');

function deriveWalletAddress(privateKey) {
  if (!privateKey) return null;
  try {
    return new Wallet(privateKey).address;
  } catch {
    return null;
  }
}

function createSigner(privateKey, provider = createProvider()) {
  return new Wallet(privateKey, provider);
}

module.exports = { deriveWalletAddress, createSigner };
