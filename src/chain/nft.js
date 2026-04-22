const { Contract } = require('ethers');
const { chain } = require('./provider');

const NFT_ABI = [
  'function claimRank(uint8 rankId, bytes signature)',
  'function hasMinted(address,uint8) view returns (bool)',
];

function createNftContract(signer) {
  return new Contract(chain.nftContract, NFT_ABI, signer);
}

async function hasMinted(providerOrSigner, wallet, rankId) {
  const contract = createNftContract(providerOrSigner);
  return contract.hasMinted(wallet, rankId);
}

async function claimRank(signer, rankId, signature) {
  const contract = createNftContract(signer);
  return contract.claimRank(rankId, signature);
}

module.exports = { hasMinted, claimRank };
