const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const Status = { None: 0, Open: 1, Assigned: 2, Submitted: 3, Approved: 4, Rejected: 5, Cancelled: 6 };
const DAY = 24 * 60 * 60;

async function deployFixture() {
  const [deployer, client, worker, other, outsider, holderNoReg] = await ethers.getSigners();

  const agentId = await (await ethers.getContractFactory("MockAgentID")).deploy();
  const registry = await (await ethers.getContractFactory("AgentGuildRegistry")).deploy(agentId.target);
  const tasks = await (await ethers.getContractFactory("AgentGuildTasks")).deploy(registry.target);
  const escrow = await (await ethers.getContractFactory("AgentGuildEscrow")).deploy(tasks.target);
  const reputation = await (await ethers.getContractFactory("AgentGuildReputation")).deploy(tasks.target);

  // client, worker, other and holderNoReg hold Agent IDs. outsider does not.
  for (const s of [client, worker, other, holderNoReg]) await agentId.mint(s.address);
  for (const s of [client, worker, other]) await registry.connect(s).register("ipfs://profile");

  const deadline = async (days = 7) => (await time.latest()) + days * DAY;
  return { deployer, client, worker, other, outsider, holderNoReg, agentId, registry, tasks, escrow, reputation, deadline };
}

async function openTask(f, designated = ethers.ZeroAddress) {
  await f.tasks.connect(f.client).createTask("ipfs://task1", await f.deadline(), designated);
  return 1n;
}

async function submittedTask(f) {
  const id = await openTask(f);
  await f.tasks.connect(f.worker).acceptTask(id);
  await f.tasks.connect(f.worker).submitWork(id, "ipfs://work");
  return id;
}

describe("Registry and Agent ID gating", () => {
  it("lets a holder register and records the profile", async () => {
    const f = await loadFixture(deployFixture);
    const a = await f.registry.getAgent(f.client.address);
    expect(a.active).to.equal(true);
    expect(a.metadataURI).to.equal("ipfs://profile");
    expect(await f.registry.agentCount()).to.equal(3n);
    expect(await f.registry.isEligible(f.client.address)).to.equal(true);
  });

  it("rejects registration from a wallet without an Agent ID", async () => {
    const f = await loadFixture(deployFixture);
    await expect(f.registry.connect(f.outsider).register("ipfs://x")).to.be.revertedWithCustomError(f.registry, "NoAgentId");
  });

  it("rejects double registration and empty or oversized URIs", async () => {
    const f = await loadFixture(deployFixture);
    await expect(f.registry.connect(f.client).register("ipfs://y")).to.be.revertedWithCustomError(f.registry, "AlreadyRegistered");
    await expect(f.registry.connect(f.holderNoReg).register("")).to.be.revertedWithCustomError(f.registry, "InvalidURI");
    await expect(f.registry.connect(f.holderNoReg).register("a".repeat(257))).to.be.revertedWithCustomError(f.registry, "InvalidURI");
  });

  it("holder who never registered is not eligible", async () => {
    const f = await loadFixture(deployFixture);
    expect(await f.registry.holdsAgentId(f.holderNoReg.address)).to.equal(true);
    expect(await f.registry.isEligible(f.holderNoReg.address)).to.equal(false);
    await expect(f.tasks.connect(f.holderNoReg).createTask("ipfs://t", await f.deadline(), ethers.ZeroAddress))
      .to.be.revertedWithCustomError(f.tasks, "NotEligible");
  });

  it("loses eligibility the moment the Agent ID is gone", async () => {
    const f = await loadFixture(deployFixture);
    await f.agentId.burn(1); // client's token
    expect(await f.registry.isEligible(f.client.address)).to.equal(false);
    await expect(f.tasks.connect(f.client).createTask("ipfs://t", await f.deadline(), ethers.ZeroAddress))
      .to.be.revertedWithCustomError(f.tasks, "NotEligible");
  });

  it("lets an agent pause and resume only while holding an Agent ID", async () => {
    const f = await loadFixture(deployFixture);
    await f.registry.connect(f.other).setActive(false);
    expect(await f.registry.isEligible(f.other.address)).to.equal(false);
    await f.registry.connect(f.other).setActive(true);
    expect(await f.registry.isEligible(f.other.address)).to.equal(true);
  });

  it("the mock Agent ID is non-transferable", async () => {
    const f = await loadFixture(deployFixture);
    await expect(f.agentId.connect(f.client).transferFrom(f.client.address, f.outsider.address, 1)).to.be.revertedWith("non-transferable");
  });
});

describe("Task lifecycle", () => {
  it("runs create, accept, submit, approve", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await expect(f.tasks.connect(f.worker).acceptTask(id)).to.emit(f.tasks, "TaskAccepted").withArgs(id, f.worker.address);
    await expect(f.tasks.connect(f.worker).submitWork(id, "ipfs://work")).to.emit(f.tasks, "WorkSubmitted");
    await expect(f.tasks.connect(f.client).approveWork(id)).to.emit(f.tasks, "WorkApproved").withArgs(id, f.client.address, f.worker.address);
    const t = await f.tasks.getTask(id);
    expect(t.status).to.equal(Status.Approved);
    expect(t.deliverableURI).to.equal("ipfs://work");
  });

  it("blocks non-holders at every step", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await expect(f.tasks.connect(f.outsider).createTask("ipfs://t", await f.deadline(), ethers.ZeroAddress)).to.be.revertedWithCustomError(f.tasks, "NotEligible");
    await expect(f.tasks.connect(f.outsider).acceptTask(id)).to.be.revertedWithCustomError(f.tasks, "NotEligible");
    await f.tasks.connect(f.worker).acceptTask(id);
    await expect(f.tasks.connect(f.outsider).submitWork(id, "ipfs://w")).to.be.revertedWithCustomError(f.tasks, "NotEligible");
    await f.tasks.connect(f.worker).submitWork(id, "ipfs://w");
    await expect(f.tasks.connect(f.outsider).approveWork(id)).to.be.revertedWithCustomError(f.tasks, "NotEligible");
    await expect(f.tasks.connect(f.outsider).rejectWork(id, "")).to.be.revertedWithCustomError(f.tasks, "NotEligible");
  });

  it("rejects bad deadlines and bad designated workers", async () => {
    const f = await loadFixture(deployFixture);
    const now = await time.latest();
    await expect(f.tasks.connect(f.client).createTask("ipfs://t", now - 1, ethers.ZeroAddress)).to.be.revertedWithCustomError(f.tasks, "InvalidDeadline");
    await expect(f.tasks.connect(f.client).createTask("ipfs://t", now + 366 * DAY, ethers.ZeroAddress)).to.be.revertedWithCustomError(f.tasks, "InvalidDeadline");
    await expect(f.tasks.connect(f.client).createTask("ipfs://t", await f.deadline(), f.client.address)).to.be.revertedWithCustomError(f.tasks, "SelfDealing");
    await expect(f.tasks.connect(f.client).createTask("ipfs://t", await f.deadline(), f.outsider.address)).to.be.revertedWithCustomError(f.tasks, "NotEligible");
  });

  it("only the designated worker can accept a designated task", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f, f.worker.address);
    await expect(f.tasks.connect(f.other).acceptTask(id)).to.be.revertedWithCustomError(f.tasks, "NotDesignatedWorker");
    await f.tasks.connect(f.worker).acceptTask(id);
  });

  it("client cannot accept their own task", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await expect(f.tasks.connect(f.client).acceptTask(id)).to.be.revertedWithCustomError(f.tasks, "SelfDealing");
  });

  it("only the assigned worker can submit and only the client can approve", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await f.tasks.connect(f.worker).acceptTask(id);
    await expect(f.tasks.connect(f.other).submitWork(id, "ipfs://w")).to.be.revertedWithCustomError(f.tasks, "NotWorker");
    await f.tasks.connect(f.worker).submitWork(id, "ipfs://w");
    await expect(f.tasks.connect(f.other).approveWork(id)).to.be.revertedWithCustomError(f.tasks, "NotClient");
    await expect(f.tasks.connect(f.worker).approveWork(id)).to.be.revertedWithCustomError(f.tasks, "NotClient");
  });

  it("worker can step back and another agent can take over", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await f.tasks.connect(f.worker).acceptTask(id);
    await expect(f.tasks.connect(f.other).releaseAssignment(id)).to.be.revertedWithCustomError(f.tasks, "NotWorker");
    await f.tasks.connect(f.worker).releaseAssignment(id);
    await f.tasks.connect(f.other).acceptTask(id);
    expect((await f.tasks.getTask(id)).worker).to.equal(f.other.address);
  });

  it("client can cancel only an open task", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await expect(f.tasks.connect(f.other).cancelTask(id)).to.be.revertedWithCustomError(f.tasks, "NotClient");
    await f.tasks.connect(f.client).cancelTask(id);
    await expect(f.tasks.connect(f.worker).acceptTask(id)).to.be.revertedWithCustomError(f.tasks, "WrongStatus");

    await f.tasks.connect(f.client).createTask("ipfs://t2", await f.deadline(), ethers.ZeroAddress);
    await f.tasks.connect(f.worker).acceptTask(2);
    await expect(f.tasks.connect(f.client).cancelTask(2)).to.be.revertedWithCustomError(f.tasks, "WrongStatus");
  });

  it("rejection returns the task for rework and extends the worker window", async () => {
    const f = await loadFixture(deployFixture);
    const id = await submittedTask(f);
    await time.increase(6 * DAY + DAY / 2); // near the deadline
    await f.tasks.connect(f.client).rejectWork(id, "ipfs://why");
    const t = await f.tasks.getTask(id);
    expect(t.status).to.equal(Status.Assigned);
    expect(t.rejections).to.equal(1);
    expect(t.deadline).to.be.gte((await time.latest()) + 3 * DAY - 5);
    await f.tasks.connect(f.worker).submitWork(id, "ipfs://work2");
    await f.tasks.connect(f.client).approveWork(id);
  });

  it("third rejection is final", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await f.tasks.connect(f.worker).acceptTask(id);
    for (let i = 0; i < 3; i++) {
      await f.tasks.connect(f.worker).submitWork(id, "ipfs://w" + i);
      await f.tasks.connect(f.client).rejectWork(id, "");
    }
    expect((await f.tasks.getTask(id)).status).to.equal(Status.Rejected);
    await expect(f.tasks.connect(f.worker).submitWork(id, "ipfs://again")).to.be.revertedWithCustomError(f.tasks, "WrongStatus");
  });

  it("blocks late acceptance and late submission", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await time.increase(8 * DAY);
    await expect(f.tasks.connect(f.worker).acceptTask(id)).to.be.revertedWithCustomError(f.tasks, "DeadlinePassed");

    await f.tasks.connect(f.client).createTask("ipfs://t2", await f.deadline(1), ethers.ZeroAddress);
    await f.tasks.connect(f.worker).acceptTask(2);
    await time.increase(4 * DAY + 10);
    await expect(f.tasks.connect(f.worker).submitWork(2, "ipfs://late")).to.be.revertedWithCustomError(f.tasks, "DeadlinePassed");
  });

  it("reverts on unknown task ids", async () => {
    const f = await loadFixture(deployFixture);
    await expect(f.tasks.getTask(0)).to.be.revertedWithCustomError(f.tasks, "InvalidTask");
    await expect(f.tasks.connect(f.worker).acceptTask(99)).to.be.revertedWithCustomError(f.tasks, "InvalidTask");
  });
});

describe("Escrow", () => {
  const AMOUNT = ethers.parseEther("0.5");

  it("holds funds, then pays the worker only after client approval", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await expect(f.escrow.connect(f.client).fund(id, { value: AMOUNT })).to.emit(f.escrow, "TaskFunded").withArgs(id, f.client.address, AMOUNT);
    expect(await f.escrow.lockedAmount(id)).to.equal(AMOUNT);

    await f.tasks.connect(f.worker).acceptTask(id);
    await f.tasks.connect(f.worker).submitWork(id, "ipfs://work");
    await expect(f.escrow.connect(f.worker).release(id)).to.be.revertedWithCustomError(f.escrow, "WrongStatus");

    await f.tasks.connect(f.client).approveWork(id);
    await expect(f.escrow.connect(f.other).release(id)).to.be.revertedWithCustomError(f.escrow, "NotParty");
    await expect(() => f.escrow.connect(f.worker).release(id)).to.changeEtherBalances([f.worker, f.escrow], [AMOUNT, -AMOUNT]);
    expect(await f.escrow.lockedAmount(id)).to.equal(0n);
    await expect(f.escrow.connect(f.client).release(id)).to.be.revertedWithCustomError(f.escrow, "NothingToSettle");
    await expect(f.escrow.connect(f.client).refund(id)).to.be.revertedWithCustomError(f.escrow, "NothingToSettle");
  });

  it("only the task client who holds an Agent ID can fund, once", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await expect(f.escrow.connect(f.outsider).fund(id, { value: AMOUNT })).to.be.revertedWithCustomError(f.escrow, "NotEligible");
    await expect(f.escrow.connect(f.other).fund(id, { value: AMOUNT })).to.be.revertedWithCustomError(f.escrow, "NotClient");
    await expect(f.escrow.connect(f.client).fund(id, { value: 0 })).to.be.revertedWithCustomError(f.escrow, "ZeroAmount");
    await f.escrow.connect(f.client).fund(id, { value: AMOUNT });
    await expect(f.escrow.connect(f.client).fund(id, { value: AMOUNT })).to.be.revertedWithCustomError(f.escrow, "AlreadyFunded");
  });

  it("cannot fund after submission or approval", async () => {
    const f = await loadFixture(deployFixture);
    const id = await submittedTask(f);
    await expect(f.escrow.connect(f.client).fund(id, { value: AMOUNT })).to.be.revertedWithCustomError(f.escrow, "WrongStatus");
  });

  it("refunds a cancelled task", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await f.escrow.connect(f.client).fund(id, { value: AMOUNT });
    await expect(f.escrow.connect(f.other).refund(id)).to.be.revertedWithCustomError(f.escrow, "NotClient");
    await f.tasks.connect(f.client).cancelTask(id);
    await expect(() => f.escrow.connect(f.client).refund(id)).to.changeEtherBalances([f.client, f.escrow], [AMOUNT, -AMOUNT]);
  });

  it("refuses refund while work is live, allows it after deadline plus grace", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await f.escrow.connect(f.client).fund(id, { value: AMOUNT });
    await f.tasks.connect(f.worker).acceptTask(id);
    await expect(f.escrow.connect(f.client).refund(id)).to.be.revertedWithCustomError(f.escrow, "RefundNotAllowed");
    await time.increase(7 * DAY + 3 * DAY - 100);
    await expect(f.escrow.connect(f.client).refund(id)).to.be.revertedWithCustomError(f.escrow, "RefundNotAllowed");
    await time.increase(200);
    await expect(() => f.escrow.connect(f.client).refund(id)).to.changeEtherBalances([f.client], [AMOUNT]);
  });

  it("never refunds a submitted task, even after the deadline", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await f.escrow.connect(f.client).fund(id, { value: AMOUNT });
    await f.tasks.connect(f.worker).acceptTask(id);
    await f.tasks.connect(f.worker).submitWork(id, "ipfs://w");
    await time.increase(30 * DAY);
    await expect(f.escrow.connect(f.client).refund(id)).to.be.revertedWithCustomError(f.escrow, "RefundNotAllowed");
  });

  it("a late reject cannot be used to refund straight away", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await f.escrow.connect(f.client).fund(id, { value: AMOUNT });
    await f.tasks.connect(f.worker).acceptTask(id);
    await time.increase(6 * DAY);
    await f.tasks.connect(f.worker).submitWork(id, "ipfs://w");
    await time.increase(20 * DAY); // client sat on it
    await f.tasks.connect(f.client).rejectWork(id, "");
    await expect(f.escrow.connect(f.client).refund(id)).to.be.revertedWithCustomError(f.escrow, "RefundNotAllowed");
    // worker still has a window to resubmit
    await f.tasks.connect(f.worker).submitWork(id, "ipfs://w2");
  });

  it("refunds after a final rejection", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await f.escrow.connect(f.client).fund(id, { value: AMOUNT });
    await f.tasks.connect(f.worker).acceptTask(id);
    for (let i = 0; i < 3; i++) {
      await f.tasks.connect(f.worker).submitWork(id, "ipfs://w" + i);
      await f.tasks.connect(f.client).rejectWork(id, "");
    }
    await expect(() => f.escrow.connect(f.client).refund(id)).to.changeEtherBalances([f.client], [AMOUNT]);
  });

  it("approved work stays payable even if the worker later loses the Agent ID", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await f.escrow.connect(f.client).fund(id, { value: AMOUNT });
    await f.tasks.connect(f.worker).acceptTask(id);
    await f.tasks.connect(f.worker).submitWork(id, "ipfs://w");
    await f.tasks.connect(f.client).approveWork(id);
    await f.agentId.burn(2); // worker's token
    await expect(() => f.escrow.connect(f.client).release(id)).to.changeEtherBalances([f.worker], [AMOUNT]);
  });

  it("resists reentrancy from a malicious worker contract", async () => {
    const f = await loadFixture(deployFixture);
    const Attacker = await ethers.getContractFactory("ReentrantWorker");
    const atk = await Attacker.deploy(f.agentId.target, f.registry.target, f.tasks.target, f.escrow.target);
    await atk.waitForDeployment();

    await f.tasks.connect(f.client).createTask("ipfs://t", await f.deadline(), atk.target);
    const id = 1n;
    await f.escrow.connect(f.client).fund(id, { value: AMOUNT });
    await atk.takeAndSubmit(id);
    await f.tasks.connect(f.client).approveWork(id);

    // The attacker tries to call release() again from its receive hook; the inner call fails
    // and is swallowed, so the outer release still pays exactly once.
    await f.escrow.connect(f.client).release(id);
    expect(await ethers.provider.getBalance(atk.target)).to.equal(AMOUNT);
    expect(await ethers.provider.getBalance(f.escrow.target)).to.equal(0n);
    expect(await atk.reentered()).to.equal(true);
    expect(await atk.reentrySucceeded()).to.equal(false);
  });
});

describe("Reputation", () => {
  async function approved(f) {
    const id = await submittedTask(f);
    await f.tasks.connect(f.client).approveWork(id);
    return id;
  }

  it("records completions, collaborators and completion rate from task outcomes", async () => {
    const f = await loadFixture(deployFixture);
    const id = await approved(f);
    await f.reputation.syncTask(id);
    await f.reputation.syncTask(id); // idempotent
    const w = await f.reputation.getStats(f.worker.address);
    const c = await f.reputation.getStats(f.client.address);
    expect(w.completed).to.equal(1);
    expect(w.collaborators).to.equal(1);
    expect(c.approvalsIssued).to.equal(1);
    expect(await f.reputation.completionRateBps(f.worker.address)).to.equal(10000n);
  });

  it("counts a repeat partner as one collaborator", async () => {
    const f = await loadFixture(deployFixture);
    const id1 = await approved(f);
    await f.tasks.connect(f.client).createTask("ipfs://t2", await f.deadline(), ethers.ZeroAddress);
    await f.tasks.connect(f.worker).acceptTask(2);
    await f.tasks.connect(f.worker).submitWork(2, "ipfs://w");
    await f.tasks.connect(f.client).approveWork(2);
    await f.reputation.syncTask(id1);
    await f.reputation.syncTask(2);
    const w = await f.reputation.getStats(f.worker.address);
    expect(w.completed).to.equal(2);
    expect(w.collaborators).to.equal(1);
  });

  it("cannot sync unfinished tasks", async () => {
    const f = await loadFixture(deployFixture);
    const id = await submittedTask(f);
    await expect(f.reputation.syncTask(id)).to.be.revertedWithCustomError(f.reputation, "TaskNotFinished");
  });

  it("records a final rejection as a failed task and a client rejection", async () => {
    const f = await loadFixture(deployFixture);
    const id = await openTask(f);
    await f.tasks.connect(f.worker).acceptTask(id);
    for (let i = 0; i < 3; i++) {
      await f.tasks.connect(f.worker).submitWork(id, "ipfs://w" + i);
      await f.tasks.connect(f.client).rejectWork(id, "");
    }
    await f.reputation.syncTask(id);
    expect((await f.reputation.getStats(f.worker.address)).failed).to.equal(1);
    expect((await f.reputation.getStats(f.client.address)).finalRejectionsIssued).to.equal(1);
    expect(await f.reputation.completionRateBps(f.worker.address)).to.equal(0n);
  });

  it("accepts one review per party per approved task and averages ratings", async () => {
    const f = await loadFixture(deployFixture);
    const id = await approved(f);
    await f.reputation.connect(f.client).submitReview(id, 5, "ipfs://c");
    await expect(f.reputation.connect(f.client).submitReview(id, 1, "")).to.be.revertedWithCustomError(f.reputation, "AlreadyReviewed");
    await f.reputation.connect(f.worker).submitReview(id, 4, "");
    expect(await f.reputation.averageRatingX100(f.worker.address)).to.equal(500n);
    expect(await f.reputation.averageRatingX100(f.client.address)).to.equal(400n);
    expect((await f.reputation.getStats(f.worker.address)).completed).to.equal(1); // auto-synced
  });

  it("blocks reviews from outsiders, non-parties, bad ratings and unapproved tasks", async () => {
    const f = await loadFixture(deployFixture);
    const id = await submittedTask(f);
    await expect(f.reputation.connect(f.client).submitReview(id, 5, "")).to.be.revertedWithCustomError(f.reputation, "TaskNotFinished");
    await f.tasks.connect(f.client).approveWork(id);
    await expect(f.reputation.connect(f.outsider).submitReview(id, 5, "")).to.be.revertedWithCustomError(f.reputation, "NotEligible");
    await expect(f.reputation.connect(f.other).submitReview(id, 5, "")).to.be.revertedWithCustomError(f.reputation, "NotParty");
    await expect(f.reputation.connect(f.client).submitReview(id, 0, "")).to.be.revertedWithCustomError(f.reputation, "InvalidRating");
    await expect(f.reputation.connect(f.client).submitReview(id, 6, "")).to.be.revertedWithCustomError(f.reputation, "InvalidRating");
  });

  it("returns zeros for agents with no history", async () => {
    const f = await loadFixture(deployFixture);
    expect(await f.reputation.completionRateBps(f.other.address)).to.equal(0n);
    expect(await f.reputation.averageRatingX100(f.other.address)).to.equal(0n);
  });
});
