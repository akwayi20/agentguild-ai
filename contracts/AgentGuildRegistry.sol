// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentID} from "./interfaces/IAgentID.sol";

/// @title AgentGuildRegistry
/// @notice Registers wallets that hold an official Agent ID. Eligibility is re-checked live
///         against the Agent ID contract on every protected call elsewhere in the system.
/// @dev No owner, no admin, no upgrade path. Nothing here can be changed after deployment.
contract AgentGuildRegistry {
    struct Agent {
        uint64 registeredAt;
        bool active;
        string metadataURI; // IPFS JSON: name, capabilities, services
    }

    uint256 public constant MAX_URI_LENGTH = 256;

    IAgentID public immutable agentId;

    mapping(address => Agent) private _agents;
    address[] private _agentList;

    event AgentRegistered(address indexed agent, string metadataURI);
    event AgentProfileUpdated(address indexed agent, string metadataURI);
    event AgentStatusChanged(address indexed agent, bool active);

    error NoAgentId();
    error AlreadyRegistered();
    error NotRegistered();
    error InvalidURI();
    error ZeroAddress();

    constructor(address agentIdContract) {
        if (agentIdContract == address(0)) revert ZeroAddress();
        agentId = IAgentID(agentIdContract);
    }

    /// @notice Register the caller. Requires the caller to hold an Agent ID right now.
    function register(string calldata metadataURI) external {
        if (agentId.balanceOf(msg.sender) == 0) revert NoAgentId();
        if (_agents[msg.sender].registeredAt != 0) revert AlreadyRegistered();
        _validateURI(metadataURI);

        _agents[msg.sender] = Agent({
            registeredAt: uint64(block.timestamp),
            active: true,
            metadataURI: metadataURI
        });
        _agentList.push(msg.sender);

        emit AgentRegistered(msg.sender, metadataURI);
    }

    function updateProfile(string calldata metadataURI) external {
        Agent storage a = _agents[msg.sender];
        if (a.registeredAt == 0) revert NotRegistered();
        if (agentId.balanceOf(msg.sender) == 0) revert NoAgentId();
        _validateURI(metadataURI);
        a.metadataURI = metadataURI;
        emit AgentProfileUpdated(msg.sender, metadataURI);
    }

    /// @notice Pause or resume your own participation.
    function setActive(bool active) external {
        Agent storage a = _agents[msg.sender];
        if (a.registeredAt == 0) revert NotRegistered();
        if (active && agentId.balanceOf(msg.sender) == 0) revert NoAgentId();
        a.active = active;
        emit AgentStatusChanged(msg.sender, active);
    }

    function isEligible(address agent) public view returns (bool) {
        Agent storage a = _agents[agent];
        return a.registeredAt != 0 && a.active && agentId.balanceOf(agent) > 0;
    }

    function holdsAgentId(address wallet) external view returns (bool) {
        return agentId.balanceOf(wallet) > 0;
    }

    function getAgent(address agent) external view returns (Agent memory) {
        return _agents[agent];
    }

    function agentCount() external view returns (uint256) {
        return _agentList.length;
    }

    function agentAt(uint256 index) external view returns (address) {
        return _agentList[index];
    }

    function _validateURI(string calldata uri) private pure {
        uint256 len = bytes(uri).length;
        if (len == 0 || len > MAX_URI_LENGTH) revert InvalidURI();
    }
}
