// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAgentGuildRegistry, IAgentGuildTasks} from "./interfaces/IAgentGuild.sol";

/// @title AgentGuildEscrow
/// @notice Optional native-BNB escrow for a task. The client funds once, the contract holds
///         the funds, and they leave only by (a) release to the worker after the client has
///         approved the work, or (b) refund to the client under the conditions below.
/// @dev No owner, no admin, no fee, no token approvals. Nobody but the task parties can move funds.
///
/// Refund conditions (client only):
///   1. Task was cancelled.
///   2. Task was finally rejected (3 rejections).
///   3. Task is still Open or Assigned and the deadline plus grace period has passed.
/// A Submitted task cannot be refunded. The client must approve or reject it.
contract AgentGuildEscrow is ReentrancyGuard {
    IAgentGuildTasks public immutable tasks;

    mapping(uint256 => uint256) public funded; // taskId => wei held or paid
    mapping(uint256 => bool) public settled;

    event TaskFunded(uint256 indexed taskId, address indexed client, uint256 amount);
    event PaymentReleased(uint256 indexed taskId, address indexed worker, uint256 amount);
    event PaymentRefunded(uint256 indexed taskId, address indexed client, uint256 amount);

    error NotEligible(address account);
    error NotClient();
    error NotParty();
    error WrongStatus(IAgentGuildTasks.Status current);
    error AlreadyFunded();
    error NothingToSettle();
    error ZeroAmount();
    error RefundNotAllowed();
    error TransferFailed();
    error ZeroAddress();

    constructor(address tasksAddress) {
        if (tasksAddress == address(0)) revert ZeroAddress();
        tasks = IAgentGuildTasks(tasksAddress);
    }

    /// @notice Client locks BNB for a task. Callable once per task, while Open or Assigned.
    function fund(uint256 taskId) external payable {
        if (msg.value == 0) revert ZeroAmount();
        if (!tasks.registry().isEligible(msg.sender)) revert NotEligible(msg.sender);

        IAgentGuildTasks.Task memory t = tasks.getTask(taskId);
        if (t.client != msg.sender) revert NotClient();
        if (t.status != IAgentGuildTasks.Status.Open && t.status != IAgentGuildTasks.Status.Assigned) {
            revert WrongStatus(t.status);
        }
        if (funded[taskId] != 0) revert AlreadyFunded();

        funded[taskId] = msg.value;
        emit TaskFunded(taskId, msg.sender, msg.value);
    }

    /// @notice Pay the worker. Only after the client approved the work. Client or worker may call.
    /// @dev Identity is not re-checked here on purpose: approved work must always be payable.
    function release(uint256 taskId) external nonReentrant {
        IAgentGuildTasks.Task memory t = tasks.getTask(taskId);
        if (msg.sender != t.client && msg.sender != t.worker) revert NotParty();
        if (t.status != IAgentGuildTasks.Status.Approved) revert WrongStatus(t.status);

        uint256 amount = funded[taskId];
        if (amount == 0 || settled[taskId]) revert NothingToSettle();

        settled[taskId] = true;
        (bool ok, ) = t.worker.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit PaymentReleased(taskId, t.worker, amount);
    }

    /// @notice Return funds to the client under the documented conditions.
    function refund(uint256 taskId) external nonReentrant {
        IAgentGuildTasks.Task memory t = tasks.getTask(taskId);
        if (msg.sender != t.client) revert NotClient();

        uint256 amount = funded[taskId];
        if (amount == 0 || settled[taskId]) revert NothingToSettle();

        bool allowed = t.status == IAgentGuildTasks.Status.Cancelled ||
            t.status == IAgentGuildTasks.Status.Rejected ||
            ((t.status == IAgentGuildTasks.Status.Open || t.status == IAgentGuildTasks.Status.Assigned) &&
                block.timestamp > uint256(t.deadline) + tasks.GRACE_PERIOD());
        if (!allowed) revert RefundNotAllowed();

        settled[taskId] = true;
        (bool ok, ) = t.client.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit PaymentRefunded(taskId, t.client, amount);
    }

    /// @notice Convenience view for the UI.
    function lockedAmount(uint256 taskId) external view returns (uint256) {
        return settled[taskId] ? 0 : funded[taskId];
    }
}
