// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BasePaymaster} from "account-abstraction/core/BasePaymaster.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Testnet ERC-4337 v0.7 paymaster: fronts MON gas, charges the account in USDC after execution.
/// Mainnet uses Pimlico's ERC-20 paymaster instead.
/// ponytail: fixed owner-set rate, no oracle; swap for a Chainlink-style feed if this ever leaves testnet.
contract USDCPaymaster is BasePaymaster {
    using SafeERC20 for IERC20;

    error InsufficientUSDC();

    event GasCharged(address indexed account, uint256 usdcAmount, uint256 gasCostWei);

    /// Extra gas billed to cover postOp itself.
    uint256 public constant POSTOP_GAS = 60_000;

    IERC20 public immutable usdc;
    /// USDC base units (6 decimals) per 1 MON (1e18 wei).
    uint256 public usdcPerMon;

    constructor(IEntryPoint ep, IERC20 usdc_, uint256 usdcPerMon_) BasePaymaster(ep) {
        usdc = usdc_;
        usdcPerMon = usdcPerMon_;
    }

    function setRate(uint256 usdcPerMon_) external onlyOwner {
        usdcPerMon = usdcPerMon_;
    }

    function quote(uint256 gasCostWei) public view returns (uint256) {
        return (gasCostWei * usdcPerMon + 1e18 - 1) / 1e18; // round up
    }

    function withdrawUSDC(address to, uint256 amount) external onlyOwner {
        usdc.safeTransfer(to, amount);
    }

    // Only the balance is checked here so the first UserOp can batch `approve` with its call.
    // ponytail: an account that never approves makes postOp revert and the paymaster eats that gas;
    // acceptable on testnet, require pre-approval (or a permit) before mainnet.
    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256 maxCost)
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        if (usdc.balanceOf(userOp.sender) < quote(maxCost)) revert InsufficientUSDC();
        return (abi.encode(userOp.sender), 0);
    }

    function _postOp(PostOpMode, bytes calldata context, uint256 actualGasCost, uint256 actualUserOpFeePerGas)
        internal
        override
    {
        address account = abi.decode(context, (address));
        uint256 cost = actualGasCost + POSTOP_GAS * actualUserOpFeePerGas;
        uint256 charge = quote(cost);
        usdc.safeTransferFrom(account, address(this), charge);
        emit GasCharged(account, charge, cost);
    }
}
