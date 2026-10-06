// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BillPay} from "../src/BillPay.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

contract BillPayTest is Test {
    MockUSDC usdc;
    BillPay bp;
    address operator = address(0x0E7A);
    address treasury = address(0x7EA5);
    address payer = address(0xA11CE);
    address stranger = address(0xBAD);

    function setUp() public {
        usdc = new MockUSDC();
        bp = new BillPay(address(usdc), operator, treasury);
        usdc.mint(payer, 100e6);
        vm.prank(payer);
        usdc.approve(address(bp), type(uint256).max);
    }

    function _pay(uint96 amt) internal returns (uint256 id) {
        vm.prank(payer);
        id = bp.pay("electricity", "45012345678", amt, "mum");
    }

    function test_payEscrowsFunds() public {
        uint256 id = _pay(10e6);
        assertEq(usdc.balanceOf(address(bp)), 10e6);
        assertEq(usdc.balanceOf(payer), 90e6);
        (address p, uint96 amount,, BillPay.Status s) = bp.orders(id);
        assertEq(p, payer);
        assertEq(amount, 10e6);
        assertEq(uint8(s), uint8(BillPay.Status.Pending));
    }

    function test_fulfillSendsToTreasury() public {
        uint256 id = _pay(10e6);
        vm.prank(operator);
        bp.fulfill(id, "TOKEN-1234-5678");
        assertEq(usdc.balanceOf(treasury), 10e6);
        assertEq(usdc.balanceOf(address(bp)), 0);
    }

    function test_refundReturnsToPayer() public {
        uint256 id = _pay(10e6);
        vm.prank(operator);
        bp.refund(id);
        assertEq(usdc.balanceOf(payer), 100e6);
    }

    function test_onlyOperatorFulfillsOrRefunds() public {
        uint256 id = _pay(10e6);
        vm.startPrank(stranger);
        vm.expectRevert(BillPay.NotOperator.selector);
        bp.fulfill(id, "x");
        vm.expectRevert(BillPay.NotOperator.selector);
        bp.refund(id);
    }

    function test_fulfillRequiresReference() public {
        uint256 id = _pay(10e6);
        vm.prank(operator);
        vm.expectRevert(BillPay.EmptyReference.selector);
        bp.fulfill(id, "");
    }

    function test_cannotSettleTwice() public {
        uint256 id = _pay(10e6);
        vm.startPrank(operator);
        bp.fulfill(id, "T");
        vm.expectRevert(BillPay.NotPending.selector);
        bp.refund(id);
        vm.expectRevert(BillPay.NotPending.selector);
        bp.fulfill(id, "T");
    }

    function test_reclaimOnlyAfterTimeout() public {
        uint256 id = _pay(10e6);
        vm.prank(payer);
        vm.expectRevert(BillPay.TooEarly.selector);
        bp.reclaim(id);

        vm.warp(block.timestamp + bp.TIMEOUT());
        vm.prank(stranger);
        vm.expectRevert(BillPay.NotPayer.selector);
        bp.reclaim(id);

        vm.prank(payer);
        bp.reclaim(id);
        assertEq(usdc.balanceOf(payer), 100e6);
    }

    function test_revertZeroAmount() public {
        vm.prank(payer);
        vm.expectRevert(BillPay.ZeroAmount.selector);
        bp.pay("airtime", "08011111111", 0, "");
    }

    function testFuzz_fundsConserved(uint96 a, uint96 b, bool fulfillA) public {
        a = uint96(bound(a, 1, 50e6));
        b = uint96(bound(b, 1, 50e6));
        uint256 idA = _pay(a);
        _pay(b);
        vm.startPrank(operator);
        if (fulfillA) bp.fulfill(idA, "T");
        else bp.refund(idA);
        vm.stopPrank();
        // escrow holds exactly the still-pending order
        assertEq(usdc.balanceOf(address(bp)), b);
        assertEq(usdc.balanceOf(payer) + usdc.balanceOf(treasury) + usdc.balanceOf(address(bp)), 100e6);
    }
}
