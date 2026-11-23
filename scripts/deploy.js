// Deploys the four AgentGuild contracts and writes deployments/<network>.json.
//   Local:    npx hardhat run scripts/deploy.js
//   Testnet:  AGENT_ID_ADDRESS=0x... npx hardhat run scripts/deploy.js --network bscTestnet
//             (or USE_MOCK_AGENT_ID=true to deploy a mock Agent ID. Testnet only.)
//   Mainnet:  npx hardhat run scripts/deploy.js --network bsc   (official Agent ID only)
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const adoption = require("../config/adoption.json");

const EXPLORERS = { 56: "https://bscscan.com", 97: "https://testnet.bscscan.com" };

async function resolveAgentId(chainId) {
  const { ethers } = hre;
  if (chainId === 56) {
    if (process.env.USE_MOCK_AGENT_ID === "true") throw new Error("Refusing to use a mock Agent ID on mainnet.");
    return { address: adoption.agentId.address, mock: false };
  }
  if (process.env.AGENT_ID_ADDRESS) return { address: ethers.getAddress(process.env.AGENT_ID_ADDRESS), mock: false };
  if (chainId === 97 && process.env.USE_MOCK_AGENT_ID !== "true") {
    throw new Error("Set AGENT_ID_ADDRESS to an Agent ID contract on this testnet, or USE_MOCK_AGENT_ID=true.");
  }
  const mock = await (await ethers.getContractFactory("MockAgentID")).deploy();
  await mock.waitForDeployment();
  console.warn("WARNING: deployed a MOCK Agent ID at", mock.target, "(not the official contract)");
  return { address: mock.target, mock: true };
}

async function deployOne(name, args, purpose, chainId, included = true) {
  const factory = await hre.ethers.getContractFactory(name);
  const c = await factory.deploy(...args);
  const receipt = await c.deploymentTransaction().wait();
  const address = await c.getAddress();
  const explorer = EXPLORERS[chainId];
  console.log(`${name.padEnd(22)} ${address}`);
  return {
    name,
    network: hre.network.name,
    chainId,
    address,
    constructorArgs: args,
    deploymentTx: receipt.hash,
    deploymentBlock: receipt.blockNumber,
    bscscanUrl: explorer ? `${explorer}/address/${address}#code` : null,
    sourceVerified: false,
    purpose,
    includedInHackathonSubmission: included,
  };
}

async function main() {
  const { chainId } = await hre.ethers.provider.getNetwork();
  const id = Number(chainId);
  const agent = await resolveAgentId(id);

  const registry = await deployOne("AgentGuildRegistry", [agent.address], "Agent registration, Agent ID gate", id);
  const tasks = await deployOne("AgentGuildTasks", [registry.address], "Task lifecycle records", id);
  const escrow = await deployOne("AgentGuildEscrow", [tasks.address], "Optional BNB escrow per task", id);
  const reputation = await deployOne("AgentGuildReputation", [tasks.address], "Reputation from finished tasks and reviews", id);

  const out = {
    network: hre.network.name,
    chainId: id,
    deployedAt: new Date().toISOString(),
    agentId: { address: agent.address, isMock: agent.mock },
    contracts: [registry, tasks, escrow, reputation],
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${hre.network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("Wrote", file);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
