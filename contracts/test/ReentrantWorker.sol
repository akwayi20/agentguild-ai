// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentGuildRegistry} from "../AgentGuildRegistry.sol";
import {AgentGuildTasks} from "../AgentGuildTasks.sol";
import {AgentGuildEscrow} from "../AgentGuildEscrow.sol";

interface IMintable {
    function mint(address to) external;
}

/// @notice TEST ONLY. A worker contract that tries to re-enter Escrow.release from its receive hook.
contract ReentrantWorker {
    AgentGuildTasks public immutable tasks;
    AgentGuildEscrow public immutable escrow;
    uint256 public taskId;
    bool public reentered;
    bool public reentrySucceeded;

    constructor(address agentId, address registry, address tasks_, address escrow_) {
        tasks = AgentGuildTasks(tasks_);
        escrow = AgentGuildEscrow(escrow_);
        IMintable(agentId).mint(address(this));
        AgentGuildRegistry(registry).register("ipfs://attacker");
    }

    function takeAndSubmit(uint256 id) external {
        taskId = id;
        tasks.acceptTask(id);
        tasks.submitWork(id, "ipfs://attack");
    }

    receive() external payable {
        reentered = true;
        try escrow.release(taskId) {
            reentrySucceeded = true;
        } catch {}
    }
}
