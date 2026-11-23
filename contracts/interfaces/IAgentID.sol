// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal view of the official Agent ID (ERC-721, non-transferable) contract.
interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}
