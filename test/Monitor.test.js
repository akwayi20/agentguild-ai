const { expect } = require("chai");
const { ethers } = require("hardhat");
const config = require("../config/adoption.json");
const { buildReport, evaluateGate } = require("../lib/participation");

describe("Participation monitor", () => {
  it("counts unique Agent ID addresses once, ignores non-holders, and gates submission", async () => {
    const signers = await ethers.getSigners();
    const agentId = await (await ethers.getContractFactory("MockAgentID")).deploy();
    const registry = await (await ethers.getContractFactory("AgentGuildRegistry")).deploy(agentId.target);
    const tasks = await (await ethers.getContractFactory("AgentGuildTasks")).deploy(registry.target);
    const escrow = await (await ethers.getContractFactory("AgentGuildEscrow")).deploy(tasks.target);
    const reputation = await (await ethers.getContractFactory("AgentGuildReputation")).deploy(tasks.target);

    const holders = signers.slice(1, 9); // 8 holders
    const outsider = signers[10];
    for (const s of holders) {
      await agentId.mint(s.address);
      await registry.connect(s).register("ipfs://p");
    }
    // Outsider tries and fails: no event, so never counted.
    await expect(registry.connect(outsider).register("ipfs://p")).to.be.reverted;

    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 7 * 86400;
    // 4 pairs complete a task. holders[0] also creates a second task (same address, counted once).
    for (let i = 0; i < 8; i += 2) {
      const client = holders[i], worker = holders[i + 1];
      const id = (await tasks.taskCount()) + 1n;
      await tasks.connect(client).createTask("ipfs://t", deadline, ethers.ZeroAddress);
      await escrow.connect(client).fund(id, { value: 1000n });
      await tasks.connect(worker).acceptTask(id);
      await tasks.connect(worker).submitWork(id, "ipfs://w");
      await tasks.connect(client).approveWork(id);
      await escrow.connect(worker).release(id);
      await reputation.connect(client).submitReview(id, 5, "");
    }
    await tasks.connect(holders[0]).createTask("ipfs://t2", deadline, ethers.ZeroAddress);

    const net = await ethers.provider.getNetwork();
    const mk = (name, c, b) => ({ name, address: c.target, deploymentBlock: b, includedInHackathonSubmission: true, sourceVerified: false });
    const deployments = {
      network: "hardhat", chainId: Number(net.chainId),
      agentId: { address: agentId.target, isMock: true },
      contracts: [mk("AgentGuildRegistry", registry, 0), mk("AgentGuildTasks", tasks, 0), mk("AgentGuildEscrow", escrow, 0), mk("AgentGuildReputation", reputation, 0)],
    };
    const opts = { windowStart: 0, windowEnd: 4102444800 };

    const report = await buildReport(ethers.provider, deployments, config, opts);
    expect(report.totals.uniqueAgentIdAddresses).to.equal(8);
    expect(report.totals.registrations).to.equal(8);
    expect(report.totals.tasksCreated).to.equal(5);
    expect(report.totals.tasksCompleted).to.equal(4);
    expect(report.totals.successfulCollaborations).to.equal(4);
    expect(report.totals.escrowFundedWei).to.equal("4000");
    expect(report.totals.addressesWithoutAgentId).to.have.length(0);
    expect(report.adoption.minimumMet).to.equal(false);
    expect(report.adoption.remainingToMinimum).to.equal(22);
    expect(report.adoption.remainingToTarget).to.equal(92);

    // A holder who loses the Agent ID stops being counted.
    await agentId.burn(1);
    const after = await buildReport(ethers.provider, deployments, config, opts);
    expect(after.totals.uniqueAgentIdAddresses).to.equal(7);
    expect(after.totals.addressesWithoutAgentId).to.have.length(1);

    // Gate must refuse: wrong chain, mock Agent ID, under 30, unverified, manual checks unset.
    const gate = await evaluateGate(ethers.provider, after, deployments, config, {});
    expect(gate.ready).to.equal(false);
    const status = Object.fromEntries(gate.items.map((i) => [i.id, i.status]));
    expect(status.bnb).to.equal("fail");
    expect(status.agentid).to.equal("fail");
    expect(status.min30).to.equal("fail");
    expect(status.addresses).to.equal("pass"); // wiring is correct
    expect(status.bscscan).to.equal("fail");
    expect(status.github).to.equal("unconfirmed");
  });

  it("an empty window reports zero without crashing", async () => {
    const agentId = await (await ethers.getContractFactory("MockAgentID")).deploy();
    const registry = await (await ethers.getContractFactory("AgentGuildRegistry")).deploy(agentId.target);
    const deployments = {
      network: "hardhat", chainId: 31337, agentId: { address: agentId.target },
      contracts: [{ name: "AgentGuildRegistry", address: registry.target, deploymentBlock: 0, includedInHackathonSubmission: true }],
    };
    const r = await buildReport(ethers.provider, deployments, config, { windowStart: 4102444800, windowEnd: 4102444900 });
    expect(r.totals.uniqueAgentIdAddresses).to.equal(0);
  });
});
