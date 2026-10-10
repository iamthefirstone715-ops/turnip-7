// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Each account can publish the bill details others may pay for it, one per category
/// (e.g. "my Ikeja prepaid meter"), so paying for another account can fill them in. Everything stored here is public.
contract BillProfile {
    error InvalidCategory();
    error EmptyAccount();
    error TooLong();

    struct Detail {
        string provider; // e.g. "ikeja-electric"
        string plan; // electricity meter type ("prepaid"/"postpaid"); empty for other categories
        string account; // phone, meter or smartcard number
    }

    uint256 public constant MAX_LEN = 40;

    event DetailSet(address indexed owner, string category, string provider, string plan, string account);
    event DetailCleared(address indexed owner, string category);

    mapping(address => mapping(bytes32 => Detail)) private _details;

    function set(string calldata category, string calldata provider, string calldata plan, string calldata account)
        external
    {
        bytes32 key = _key(category);
        if (bytes(account).length == 0 || bytes(provider).length == 0) revert EmptyAccount();
        if (bytes(provider).length > MAX_LEN || bytes(plan).length > MAX_LEN || bytes(account).length > MAX_LEN) {
            revert TooLong();
        }
        _details[msg.sender][key] = Detail(provider, plan, account);
        emit DetailSet(msg.sender, category, provider, plan, account);
    }

    function clear(string calldata category) external {
        delete _details[msg.sender][_key(category)];
        emit DetailCleared(msg.sender, category);
    }

    /// @return The saved detail; an empty `account` means nothing is saved for that category.
    function get(address owner, string calldata category) external view returns (Detail memory) {
        return _details[owner][_key(category)];
    }

    function _key(string calldata category) private pure returns (bytes32 key) {
        key = keccak256(bytes(category));
        if (
            key != keccak256("airtime") && key != keccak256("data") && key != keccak256("electricity")
                && key != keccak256("tv")
        ) revert InvalidCategory();
    }
}
