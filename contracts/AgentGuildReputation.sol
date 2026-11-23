// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentGuildRegistry, IAgentGuildTasks} from "./interfaces/IAgentGuild.sol";

/// @title AgentGuildReputation
/// @notice Reputation computed only from finished tasks and one review per party per task.
///         Nothing is written by an off-chain scorer or by an admin.
/// @dev No owner, no admin. Anyone may call syncTask, because it only copies facts that
///      already exist in AgentGuildTasks.
contract AgentGuildReputation {
    struct Stats {
        uint32 completed; // worker: approved tasks
        uint32 failed; // worker: tasks finally rejected
        uint32 collaborators; // unique counterparties on approved tasks
        uint32 ratingCount;
        uint32 ratingSum;
        uint32 approvalsIssued; // client: tasks approved
        uint32 finalRejectionsIssued; // client: tasks finally rejected
    }

    IAgentGuildTasks public immutable tasks;
    IAgentGuildRegistry public immutable registry;

    mapping(address => Stats) private _stats;
    mapping(uint256 => bool) public synced;
    mapping(address => mapping(address => bool)) private _collaborated;
    mapping(uint256 => mapping(address => bool)) public reviewed;

    event TaskRecorded(uint256 indexed taskId, address indexed worker, address indexed client, bool approved);
    event ReviewSubmitted(
        uint256 indexed taskId,
        address indexed reviewer,
        address indexed reviewee,
        uint8 rating,
        string commentURI
    );

    error NotEligible(address account);
    error TaskNotFinished();
    error NotParty();
    error AlreadyReviewed();
    error InvalidRating();
    error InvalidURI();
    error ZeroAddress();

    constructor(address tasksAddress) {
        if (tasksAddress == address(0)) revert ZeroAddress();
        tasks = IAgentGuildTasks(tasksAddress);
        registry = IAgentGuildTasks(tasksAddress).registry();
    }

    /// @notice Copy the final outcome of a task into reputation. Idempotent.
    function syncTask(uint256 taskId) external {
        _sync(taskId);
    }

    /// @notice Rate the other party of an approved task. One review per party per task.
    function submitReview(uint256 taskId, uint8 rating, string calldata commentURI) external {
        if (!registry.isEligible(msg.sender)) revert NotEligible(msg.sender);
        if (rating < 1 || rating > 5) revert InvalidRating();
        if (bytes(commentURI).length > 256) revert InvalidURI();

        IAgentGuildTasks.Task memory t = tasks.getTask(taskId);
        if (t.status != IAgentGuildTasks.Status.Approved) revert TaskNotFinished();

        address reviewee;
        if (msg.sender == t.client) reviewee = t.worker;
        else if (msg.sender == t.worker) reviewee = t.client;
        else revert NotParty();

        if (reviewed[taskId][msg.sender]) revert AlreadyReviewed();
        reviewed[taskId][msg.sender] = true;

        if (!synced[taskId]) _sync(taskId);

        Stats storage s = _stats[reviewee];
        s.ratingCount += 1;
        s.ratingSum += rating;

        emit ReviewSubmitted(taskId, msg.sender, reviewee, rating, commentURI);
    }

    function getStats(address agent) external view returns (Stats memory) {
        return _stats[agent];
    }

    /// @notice completed / (completed + failed), in basis points. 0 if no finished tasks.
    function completionRateBps(address agent) external view returns (uint256) {
        Stats storage s = _stats[agent];
        uint256 total = uint256(s.completed) + s.failed;
        if (total == 0) return 0;
        return (uint256(s.completed) * 10_000) / total;
    }

    /// @notice Average rating times 100 (e.g. 450 = 4.50). 0 if no reviews.
    function averageRatingX100(address agent) external view returns (uint256) {
        Stats storage s = _stats[agent];
        if (s.ratingCount == 0) return 0;
        return (uint256(s.ratingSum) * 100) / s.ratingCount;
    }

    function _sync(uint256 taskId) private {
        IAgentGuildTasks.Task memory t = tasks.getTask(taskId);
        bool approved = t.status == IAgentGuildTasks.Status.Approved;
        if (!approved && t.status != IAgentGuildTasks.Status.Rejected) revert TaskNotFinished();
        if (synced[taskId]) return;
        synced[taskId] = true;

        Stats storage w = _stats[t.worker];
        Stats storage c = _stats[t.client];

        if (approved) {
            w.completed += 1;
            c.approvalsIssued += 1;
            if (!_collaborated[t.worker][t.client]) {
                _collaborated[t.worker][t.client] = true;
                _collaborated[t.client][t.worker] = true;
                w.collaborators += 1;
                c.collaborators += 1;
            }
        } else {
            w.failed += 1;
            c.finalRejectionsIssued += 1;
        }
        emit TaskRecorded(taskId, t.worker, t.client, approved);
    }
}
