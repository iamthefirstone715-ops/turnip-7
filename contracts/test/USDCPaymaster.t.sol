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

    function setUp() public {
        ep = new EntryPoint();
        factory = new SimpleAccountFactory(IEntryPoint(address(ep)));
        usdc = new MockUSDC();
        pm = new USDCPaymaster(IEntryPoint(address(ep)), IERC20(address(usdc)), 50_000); // 1 MON = $0.05
        pm.deposit{value: 10 ether}();
        account = factory.createAccount(vm.addr(ownerKey), 0);
        usdc.mint(address(account), 100e6);
        vm.fee(1 gwei);
    }

    function _op(bytes memory callData) internal view returns (PackedUserOperation memory op) {
        op.sender = address(account);
        op.nonce = ep.getNonce(address(account), 0);
        op.callData = callData;
        op.accountGasLimits = bytes32((uint256(200_000) << 128) | 200_000);
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

    function _batch(bytes memory approveData, bytes memory transferData) internal view returns (bytes memory) {
        address[] memory dest = new address[](2);
        bytes[] memory data = new bytes[](2);
        dest[0] = address(usdc);
        dest[1] = address(usdc);
        data[0] = approveData;
        data[1] = transferData;
        return abi.encodeCall(SimpleAccount.executeBatch, (dest, new uint256[](2), data));
    }

    function test_userPaysGasInUSDC_noMON() public {
        assertEq(address(account).balance, 0, "account holds no MON");
        uint256 pmDepositBefore = ep.balanceOf(address(pm));

        _send(
            _op(
                _batch(
                    abi.encodeCall(IERC20.approve, (address(pm), type(uint256).max)),
                    abi.encodeCall(IERC20.transfer, (bob, 5e6))
                )
            )
        );

        uint256 charged = usdc.balanceOf(address(pm));
        assertEq(usdc.balanceOf(bob), 5e6, "recipient got exact amount");
        assertGt(charged, 0, "gas charged in USDC");
        assertEq(usdc.balanceOf(address(account)), 100e6 - 5e6 - charged, "fee came from USDC");
        assertLt(ep.balanceOf(address(pm)), pmDepositBefore, "paymaster fronted MON");
        assertEq(address(account).balance, 0, "still no MON");
    }

    function test_rejectsAccountWithoutUSDC() public {
        SimpleAccount broke = factory.createAccount(vm.addr(ownerKey), 1);
        account = broke;
        PackedUserOperation memory op = _op(_batch("", ""));
        vm.expectRevert(); // FailedOpWithRevert from paymaster validation
        _send(op);
    }
}
