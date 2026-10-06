// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Maps @usernames to wallet addresses. One name per address, permanent.
contract UsernameRegistry {
    error InvalidName();
    error NameTaken();
    error AlreadyRegistered();

    event Registered(address indexed owner, string name);

    mapping(bytes32 => address) private _owners;
    mapping(address => string) public nameOf;

    function register(string calldata name) external {
        if (!_valid(bytes(name))) revert InvalidName();
        if (bytes(nameOf[msg.sender]).length != 0) revert AlreadyRegistered();
        bytes32 key = keccak256(bytes(name));
        if (_owners[key] != address(0)) revert NameTaken();
        _owners[key] = msg.sender;
        nameOf[msg.sender] = name;
        emit Registered(msg.sender, name);
    }

    function resolve(string calldata name) external view returns (address) {
        return _owners[keccak256(bytes(name))];
    }

    function _valid(bytes calldata b) private pure returns (bool) {
        if (b.length < 3 || b.length > 20) return false;
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (!((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "_")) return false;
        }
        return true;
    }
}
