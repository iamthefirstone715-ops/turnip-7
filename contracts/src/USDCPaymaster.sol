// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BasePaymaster} from "account-abstraction/core/BasePaymaster.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Testnet ERC-4337 v0.7 paymaster: fronts MON gas and charges the account in USDC.
/// The maximum fee is taken during validation and the unused part refunded afterwards, so a call that reverts or
/// revokes its approval can never leave the gas unpaid. An account that has not approved yet may only send that
/// approval, which is charged after it runs. Mainnet would use Pimlico's ERC-20 paymaster instead.
/// ponytail: fixed owner-set rate under a hard ceiling, no oracle; swap for a price feed if this leaves testnet.
contract USDCPaymaster is BasePaymaster {
    using SafeERC20 for IERC20;

    error InsufficientUSDC();
    error NotApproved();
    error FeeTooHigh();
    error RateTooHigh();

    event GasCharged(address indexed account, uint256 usdcAmount, uint256 gasCostWei);

    /// Extra gas billed to cover postOp itself.
    uint256 public constant POSTOP_GAS = 60_000;
    /// No single operation can cost more than this, whatever the rate.
    uint256 public constant MAX_FEE = 1e6; // 1 USDC
    /// An approval-only operation needs at least this much call gas, so it can't be made to fail on purpose.
    uint256 public constant MIN_APPROVAL_CALL_GAS = 60_000;
    /// SimpleAccount.execute(address,uint256,bytes)
    bytes4 private constant EXECUTE = 0xb61d27f6;

    IERC20 public immutable usdc;
    /// The owner can never set the rate above this.
    uint256 public immutable maxUsdcPerMon;
    /// USDC base units (6 decimals) per 1 MON (1e18 wei).
    uint256 public usdcPerMon;

    constructor(IEntryPoint ep, IERC20 usdc_, uint256 usdcPerMon_, uint256 maxUsdcPerMon_) BasePaymaster(ep) {
        if (usdcPerMon_ > maxUsdcPerMon_) revert RateTooHigh();
        usdc = usdc_;
        usdcPerMon = usdcPerMon_;
        maxUsdcPerMon = maxUsdcPerMon_;
    }

    function setRate(uint256 usdcPerMon_) external onlyOwner {
        if (usdcPerMon_ > maxUsdcPerMon) revert RateTooHigh();
        usdcPerMon = usdcPerMon_;
    }

    function quote(uint256 gasCostWei) public view returns (uint256) {
        return (gasCostWei * usdcPerMon + 1e18 - 1) / 1e18; // round up
    }

    function withdrawUSDC(address to, uint256 amount) external onlyOwner {
        usdc.safeTransfer(to, amount);
    }

    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256 maxCost)
        internal
        override
        returns (bytes memory context, uint256 validationData)
    {
        uint256 maxCharge = quote(maxCost);
        if (maxCharge > MAX_FEE) revert FeeTooHigh();
        address sender = userOp.sender;

        if (usdc.allowance(sender, address(this)) >= maxCharge) {
            usdc.safeTransferFrom(sender, address(this), maxCharge); // prepaid; the excess is refunded in postOp
            return (abi.encode(sender, maxCharge, true), 0);
        }

        // Not approved yet: the only operation allowed is approving this paymaster, charged once it has run.
        if (!_isApprovalOnly(userOp.callData, maxCharge)) revert NotApproved();
        if (uint128(uint256(userOp.accountGasLimits)) < MIN_APPROVAL_CALL_GAS) revert NotApproved();
        if (usdc.balanceOf(sender) < maxCharge) revert InsufficientUSDC();
        return (abi.encode(sender, maxCharge, false), 0);
    }

    function _postOp(PostOpMode, bytes calldata context, uint256 actualGasCost, uint256 actualUserOpFeePerGas)
        internal
        override
    {
        (address account, uint256 maxCharge, bool prepaid) = abi.decode(context, (address, uint256, bool));
        uint256 cost = actualGasCost + POSTOP_GAS * actualUserOpFeePerGas;
        uint256 charge = quote(cost);
        if (charge > maxCharge) charge = maxCharge;
        if (prepaid) {
            if (maxCharge > charge) usdc.safeTransfer(account, maxCharge - charge);
        } else {
            usdc.safeTransferFrom(account, address(this), charge);
        }
        emit GasCharged(account, charge, cost);
    }

    /// True if callData is exactly execute(usdc, 0, approve(this, amount >= minAmount)).
    function _isApprovalOnly(bytes calldata data, uint256 minAmount) private view returns (bool) {
        if (data.length < 4 || bytes4(data[:4]) != EXECUTE) return false;
        (address target, uint256 value, bytes memory inner) = abi.decode(data[4:], (address, uint256, bytes));
        if (target != address(usdc) || value != 0 || inner.length != 68) return false;
        bytes4 sel;
        address spender;
        uint256 amount;
        assembly ("memory-safe") {
            sel := mload(add(inner, 32))
            spender := mload(add(inner, 36))
            amount := mload(add(inner, 68))
        }
        return sel == IERC20.approve.selector && spender == address(this) && amount >= minAmount;
    }
}
