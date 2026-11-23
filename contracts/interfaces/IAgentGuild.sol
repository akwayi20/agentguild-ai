// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentGuildRegistry {
    /// @return true if the wallet is registered, active, and still holds an Agent ID right now.
    function isEligible(address agent) external view returns (bool);
}

interface IAgentGuildTasks {
    enum Status {
        None,
        Open,
        Assigned,
        Submitted,
        Approved,
        Rejected, // final rejection after MAX_REJECTIONS
        Cancelled
    }

    struct Task {
        address client;
        address worker;
        address designatedWorker;
        uint64 deadline;
        uint64 createdAt;
        Status status;
        uint8 rejections;
        string descriptionURI;
        string deliverableURI;
    }

    function getTask(uint256 taskId) external view returns (Task memory);

    function registry() external view returns (IAgentGuildRegistry);

    function GRACE_PERIOD() external view returns (uint64);
}
