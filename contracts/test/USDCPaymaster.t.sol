// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {SimpleAccount} from "account-abstraction/samples/SimpleAccount.sol";
import {SimpleAccountFactory} from "account-abstraction/samples/SimpleAccountFactory.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {USDCPaymaster} from "../src/USDCPaymaster.sol";
import {MockUSDC} from "./BillPay.t.sol";

contract USDCPaymasterTest is Test {
    EntryPoint ep;
    SimpleAccountFactory factory;
    MockUSDC usdc;
    USDCPaymaster pm;
    SimpleAccount account;
    uint256 ownerKey = 0xA11CE;
    address bob = address(0xB0B);
    address payable bundler = payable(address(0xB0D1E));
    uint128 callGas = 200_000;

    function setUp() public {
        ep = new EntryPoint();
        factory = new SimpleAccountFactory(IEntryPoint(address(ep)));
        usdc = new MockUSDC();
        // 1 MON = $0.05, and the owner can never go above 1e12 (1,000,000 USDC per MON)
        pm = new USDCPaymaster(IEntryPoint(address(ep)), IERC20(address(usdc)), 50_000, 1e12);
        pm.deposit{value: 10 ether}();
        account = factory.createAccount(vm.addr(ownerKey), 0);
        usdc.mint(address(account), 100e6);
        vm.fee(1 gwei);
    }

    function _op(bytes memory callData) internal view returns (PackedUserOperation memory op) {
        op.sender = address(account);
        op.nonce = ep.getNonce(address(account), 0);
        op.callData = callData;
        op.accountGasLimits = bytes32((uint256(200_000) << 128) | callGas);
        op.preVerificationGas = 50_000;
        op.gasFees = bytes32((uint256(1 gwei) << 128) | 2 gwei);
        op.paymasterAndData = abi.encodePacked(address(pm), uint128(100_000), uint128(100_000));
        bytes32 h = MessageHashUtils.toEthSignedMessageHash(ep.getUserOpHash(op));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, h);
        op.signature = abi.encodePacked(r, s, v);
    }

    function _send(PackedUserOperation memory op) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        ep.handleOps(ops, bundler);
    }

    /// The EntryPoint wraps a paymaster validation revert as FailedOpWithRevert(0, "AA33 reverted", reason).
    function _expectPaymaster(bytes4 err) internal {
        vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOpWithRevert.selector, uint256(0), "AA33 reverted", abi.encodeWithSelector(err)));
    }

    function _call(bytes memory inner) internal view returns (bytes memory) {
        return abi.encodeCall(SimpleAccount.execute, (address(usdc), 0, inner));
    }

    function _approve(uint256 amount) internal view returns (bytes memory) {
        return _call(abi.encodeCall(IERC20.approve, (address(pm), amount)));
    }

    function _batch(bytes memory a, bytes memory b) internal view returns (bytes memory) {
        address[] memory dest = new address[](2);
        bytes[] memory data = new bytes[](2);
        dest[0] = address(usdc);
        dest[1] = address(usdc);
        data[0] = a;
        data[1] = b;
        return abi.encodeCall(SimpleAccount.executeBatch, (dest, new uint256[](2), data));
    }

    function test_firstUseApprovesThenPaysGasInUSDC_noMON() public {
        assertEq(address(account).balance, 0, "account holds no MON");
        _send(_op(_approve(2e6))); // first op: the approval itself, charged after it runs
        uint256 feeOne = usdc.balanceOf(address(pm));
        assertGt(feeOne, 0, "approval op charged in USDC");

        _send(_op(_call(abi.encodeCall(IERC20.transfer, (bob, 5e6))))); // later ops: prepaid, excess refunded
        uint256 fees = usdc.balanceOf(address(pm));
        assertGt(fees, feeOne);
        assertEq(usdc.balanceOf(bob), 5e6, "recipient got the exact amount");
        assertEq(usdc.balanceOf(address(account)), 100e6 - 5e6 - fees, "only the real fee left the account");
        assertEq(address(account).balance, 0, "still no MON");
    }

    function test_withoutApproval_onlyAnApprovalIsAccepted() public {
        PackedUserOperation memory op = _op(_call(abi.encodeCall(IERC20.transfer, (bob, 1e6))));
        _expectPaymaster(USDCPaymaster.NotApproved.selector);
        _send(op);
    }

    function test_approvalTooSmallIsRejected() public {
        PackedUserOperation memory op = _op(_approve(1));
        _expectPaymaster(USDCPaymaster.NotApproved.selector);
        _send(op); // below the maximum fee
    }

    function test_approvalOnlyNeedsEnoughCallGas() public {
        callGas = 30_000; // could be made to fail on purpose, leaving the paymaster unpaid
        PackedUserOperation memory op = _op(_approve(2e6));
        _expectPaymaster(USDCPaymaster.NotApproved.selector);
        _send(op);
    }

    function test_revokingApprovalMidOperationStillPaysTheGas() public {
        _send(_op(_approve(2e6)));
        uint256 before = usdc.balanceOf(address(pm));
        // the audit attack: revoke the paymaster inside the operation so postOp can't charge
        _send(_op(_batch(abi.encodeCall(IERC20.approve, (address(pm), 0)), abi.encodeCall(IERC20.transfer, (bob, 1e6)))));
        assertGt(usdc.balanceOf(address(pm)), before, "gas was still paid, up front");
        assertEq(usdc.allowance(address(account), address(pm)), 0);
    }

    function test_revertingCallStillPaysTheGas() public {
        _send(_op(_approve(2e6)));
        uint256 pmBefore = usdc.balanceOf(address(pm));
        uint256 accBefore = usdc.balanceOf(address(account));
        _send(_op(_call(abi.encodeCall(IERC20.transfer, (bob, 1_000e6))))); // more than it holds: the call reverts
        uint256 fee = usdc.balanceOf(address(pm)) - pmBefore;
        assertGt(fee, 0, "paymaster paid for the failed call");
        assertEq(usdc.balanceOf(address(account)), accBefore - fee, "account lost only the fee");
        assertEq(usdc.balanceOf(bob), 0);
    }

    function test_rateHasACeilingAndFeesHaveACap() public {
        vm.expectRevert(USDCPaymaster.RateTooHigh.selector);
        pm.setRate(1e12 + 1);

        _send(_op(_approve(2e6)));
        pm.setRate(1e12); // allowed, but now any operation would cost more than MAX_FEE
        uint256 before = usdc.balanceOf(address(account));
        PackedUserOperation memory op = _op(_call(abi.encodeCall(IERC20.transfer, (bob, 1e6))));
        _expectPaymaster(USDCPaymaster.FeeTooHigh.selector); // the owner can't use the rate to drain an account
        _send(op);
        assertEq(usdc.balanceOf(address(account)), before);
    }

    function test_rejectsAccountWithoutUSDC() public {
        account = factory.createAccount(vm.addr(ownerKey), 1);
        PackedUserOperation memory op = _op(_approve(2e6));
        _expectPaymaster(USDCPaymaster.InsufficientUSDC.selector);
        _send(op);
    }

    function test_onlyOwnerSetsTheRate() public {
        vm.prank(bob);
        vm.expectRevert();
        pm.setRate(1);
    }
}
