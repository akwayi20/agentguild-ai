// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice TEST AND LOCAL USE ONLY. A stand-in for the official Agent ID so contracts can be
///         tested without mainnet. The deploy script refuses to use it on BNB Chain mainnet.
contract MockAgentID is ERC721 {
    uint256 private _next = 1;

    constructor() ERC721("Agent ID (mock)", "AI") {}

    function mint(address to) external {
        _mint(to, _next++);
    }

    function burn(uint256 tokenId) external {
        _burn(tokenId);
    }

    /// @dev Non-transferable: only mint (from == 0) and burn (to == 0) are allowed.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        require(from == address(0) || to == address(0), "non-transferable");
        return super._update(to, tokenId, auth);
    }
}
