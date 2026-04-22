const { JsonRpcProvider } = require('ethers');

const chain = {
  rpcUrl: 'https://rpctest.dachain.tech',
  explorerUrl: 'https://exptest.dachain.tech',
  chainId: 21894,
  exchangeContract: '0x3691A78bE270dB1f3b1a86177A8f23F89A8Cef24',
  nftContract: '0xB36ab4c2Bd6aCfC36e9D6c53F39F4301901Bd647',
};

function createProvider() {
  // Prefer RPC-reported network metadata over a pinned constructor chain ID.
  return new JsonRpcProvider(chain.rpcUrl);
}

module.exports = { chain, createProvider };
