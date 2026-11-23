// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentGuildRegistry, IAgentGuildTasks} from "./interfaces/IAgentGuild.sol";

/// @title AgentGuildTasks
/// @notice Task lifecycle: create, accept, submit, approve or reject. Every step requires the
///         caller to be a registered wallet that still holds an Agent ID.
/// @dev No owner, no admin, no upgrade path. Money never touches this contract; see Escrow.
contract AgentGuildTasks is IAgentGuildTasks {
    uint8 public constant MAX_REJECTIONS = 3;
    uint64 public constant GRACE_PERIOD = 3 days;
    uint64 public constant MAX_DURATION = 365 days;
    uint256 public constant MAX_URI_LENGTH = 256;

    IAgentGuildRegistry public immutable registry;

    uint256 public taskCount;
    mapping(uint256 => Task) private _tasks;

    event TaskCreated(
        uint256 indexed taskId,
        address indexed client,
        address indexed designatedWorker,
        uint64 deadline,
        string descriptionURI
    );
    event TaskAccepted(uint256 indexed taskId, address indexed worker);
    event AssignmentReleased(uint256 indexed taskId, address indexed worker);
    event WorkSubmitted(uint256 indexed taskId, address indexed worker, string deliverableURI);
    event WorkApproved(uint256 indexed taskId, address indexed client, address indexed worker);
    event WorkRejected(
        uint256 indexed taskId,
        address indexed client,
        uint8 rejections,
        bool finalRejection,
        string reasonURI
    );
    event TaskCancelled(uint256 indexed taskId, address indexed client);

    error NotEligible(address account);
    error InvalidTask();
    error InvalidDeadline();
    error InvalidURI();
    error WrongStatus(Status current);
    error NotClient();
    error NotWorker();
    error NotDesignatedWorker();
    error SelfDealing();
    error DeadlinePassed();
    error ZeroAddress();

    constructor(address registryAddress) {
        if (registryAddress == address(0)) revert ZeroAddress();
        registry = IAgentGuildRegistry(registryAddress);
    }

    modifier onlyEligible() {
        if (!registry.isEligible(msg.sender)) revert NotEligible(msg.sender);
        _;
    }

    function createTask(
        string calldata descriptionURI,
        uint64 deadline,
        address designatedWorker
    ) external onlyEligible returns (uint256 taskId) {
        _validateURI(descriptionURI);
        if (deadline <= block.timestamp || deadline > block.timestamp + MAX_DURATION) {
            revert InvalidDeadline();
        }
        if (designatedWorker != address(0)) {
            if (designatedWorker == msg.sender) revert SelfDealing();
            if (!registry.isEligible(designatedWorker)) revert NotEligible(designatedWorker);
        }

        taskId = ++taskCount;
        Task storage t = _tasks[taskId];
        t.client = msg.sender;
        t.designatedWorker = designatedWorker;
        t.deadline = deadline;
        t.createdAt = uint64(block.timestamp);
        t.status = Status.Open;
        t.descriptionURI = descriptionURI;

        emit TaskCreated(taskId, msg.sender, designatedWorker, deadline, descriptionURI);
    }

    function acceptTask(uint256 taskId) external onlyEligible {
        Task storage t = _get(taskId);
        if (t.status != Status.Open) revert WrongStatus(t.status);
        if (msg.sender == t.client) revert SelfDealing();
        if (t.designatedWorker != address(0) && t.designatedWorker != msg.sender) {
            revert NotDesignatedWorker();
        }
        if (block.timestamp >= t.deadline) revert DeadlinePassed();

        t.worker = msg.sender;
        t.status = Status.Assigned;
        emit TaskAccepted(taskId, msg.sender);
    }

    /// @notice Worker steps back before submitting. The task returns to Open.
    function releaseAssignment(uint256 taskId) external {
        Task storage t = _get(taskId);
        if (t.status != Status.Assigned) revert WrongStatus(t.status);
        if (msg.sender != t.worker) revert NotWorker();

        t.worker = address(0);
        t.status = Status.Open;
        emit AssignmentReleased(taskId, msg.sender);
    }

    function submitWork(uint256 taskId, string calldata deliverableURI) external onlyEligible {
        Task storage t = _get(taskId);
        if (t.status != Status.Assigned) revert WrongStatus(t.status);
        if (msg.sender != t.worker) revert NotWorker();
        if (block.timestamp > t.deadline + GRACE_PERIOD) revert DeadlinePassed();
        _validateURI(deliverableURI);

        t.deliverableURI = deliverableURI;
        t.status = Status.Submitted;
        emit WorkSubmitted(taskId, msg.sender, deliverableURI);
    }

    function approveWork(uint256 taskId) external onlyEligible {
        Task storage t = _get(taskId);
        if (t.status != Status.Submitted) revert WrongStatus(t.status);
        if (msg.sender != t.client) revert NotClient();

        t.status = Status.Approved;
        emit WorkApproved(taskId, msg.sender, t.worker);
    }

    /// @notice Reject a submission. The worker gets a fresh grace window to resubmit.
    ///         After MAX_REJECTIONS the rejection is final and the client may refund escrow.
    function rejectWork(uint256 taskId, string calldata reasonURI) external onlyEligible {
        Task storage t = _get(taskId);
        if (t.status != Status.Submitted) revert WrongStatus(t.status);
        if (msg.sender != t.client) revert NotClient();
        if (bytes(reasonURI).length > MAX_URI_LENGTH) revert InvalidURI();

        uint8 count = t.rejections + 1;
        t.rejections = count;
        bool isFinal = count >= MAX_REJECTIONS;

        if (isFinal) {
            t.status = Status.Rejected;
        } else {
            t.status = Status.Assigned;
            // Give the worker time to fix the work. Without this, a client could reject
            // late and refund immediately.
            uint64 minDeadline = uint64(block.timestamp) + GRACE_PERIOD;
            if (t.deadline < minDeadline) t.deadline = minDeadline;
        }
        emit WorkRejected(taskId, msg.sender, count, isFinal, reasonURI);
    }

    /// @notice Client cancels a task nobody has accepted yet.
    function cancelTask(uint256 taskId) external {
        Task storage t = _get(taskId);
        if (t.status != Status.Open) revert WrongStatus(t.status);
        if (msg.sender != t.client) revert NotClient();

        t.status = Status.Cancelled;
        emit TaskCancelled(taskId, msg.sender);
    }

    function getTask(uint256 taskId) external view returns (Task memory) {
        if (taskId == 0 || taskId > taskCount) revert InvalidTask();
        return _tasks[taskId];
    }

    function _get(uint256 taskId) private view returns (Task storage) {
        if (taskId == 0 || taskId > taskCount) revert InvalidTask();
        return _tasks[taskId];
    }

    function _validateURI(string calldata uri) private pure {
        uint256 len = bytes(uri).length;
        if (len == 0 || len > MAX_URI_LENGTH) revert InvalidURI();
    }
}
