const { Contract, parseEther } = require('ethers');
const { chain } = require('./provider');

const EXCHANGE_ABI = [
  'function burnForQE() payable',
  'function stake() payable',
];

function createExchange(signer) {
  return new Contract(chain.exchangeContract, EXCHANGE_ABI, signer);
}

async function burnForQE(signer, amount) {
  const contract = createExchange(signer);
  return contract.burnForQE({ value: parseEther(String(amount)) });
}

async function stakeDacc(signer, amount) {
  const contract = createExchange(signer);
  return contract.stake({ value: parseEther(String(amount)) });
}

module.exports = { burnForQE, stakeDacc };
