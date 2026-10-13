// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {BillPay} from "../src/BillPay.sol";
import {Scheduler, IBillPay} from "../src/Scheduler.sol";
import {MockUSDC} from "./BillPay.t.sol";

contract SchedulerTest is Test {
    MockUSDC usdc;
    BillPay bp;
    Scheduler sch;
    address operator = address(0x0E7A);
    address treasury = address(0x7EA5);
    address mum = address(0xA11CE);
    address keeper = address(0xBEEF);

    function setUp() public {
        usdc = new MockUSDC();
        bp = new BillPay(address(usdc), operator, treasury);
        sch = new Scheduler(IBillPay(address(bp)));
        vm.prank(operator);
        bp.setScheduler(address(sch));
        usdc.mint(mum, 100e6);
        vm.prank(mum);
        usdc.approve(address(bp), 30e6); // the spend cap: three runs of 10
    }

    function _create(uint16 runs) internal returns (uint256 id) {
        vm.prank(mum);
        id = sch.create("electricity:ikeja-electric:prepaid", "45012345678", "mum", 10e6, 1 days, runs, 0);
    }

    function test_runPullsFromTheOwnerNotTheKeeper() public {
        uint256 id = _create(3);
        vm.prank(keeper); // anyone may trigger a due run
        uint256 orderId = sch.execute(id);
        assertEq(usdc.balanceOf(mum), 90e6);
        assertEq(usdc.balanceOf(keeper), 0);
        (address payer, uint96 amount,,) = bp.orders(orderId);
        assertEq(payer, mum, "mum is the payer of record");
        assertEq(amount, 10e6);
    }

    function test_notDueUntilInterval_thenRepeats() public {
        uint256 id = _create(3);
        sch.execute(id);
        vm.expectRevert(Scheduler.NotDue.selector);
        sch.execute(id);
        vm.warp(block.timestamp + 1 days);
        sch.execute(id);
        assertEq(usdc.balanceOf(mum), 80e6);
    }

    function test_stopsAfterTheLastRun() public {
        uint256 id = _create(2);
        sch.execute(id);
        vm.warp(block.timestamp + 1 days);
        sch.execute(id);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(Scheduler.Inactive.selector);
        sch.execute(id);
        assertEq(sch.get(id).runsLeft, 0);
    }

    function test_cannotSpendBeyondTheApprovedCap() public {
        uint256 id = _create(5); // wants 50, approved 30
        for (uint256 i; i < 3; i++) {
            sch.execute(id);
            vm.warp(block.timestamp + 1 days);
        }
        vm.expectRevert(); // allowance exhausted
        sch.execute(id);
        assertEq(usdc.balanceOf(mum), 70e6);
        assertEq(sch.get(id).runsLeft, 2, "a failed run does not use up a run");
    }

    function test_refundGoesBackToTheOwner() public {
        uint256 id = _create(3);
        uint256 orderId = sch.execute(id);
        vm.prank(operator);
        bp.refund(orderId);
        assertEq(usdc.balanceOf(mum), 100e6, "mum got her money back, not the scheduler");
        assertEq(usdc.balanceOf(address(sch)), 0);
    }

    function test_ownerCanReclaimAfterTimeout() public {
        uint256 id = _create(3);
        uint256 orderId = sch.execute(id);
        vm.warp(block.timestamp + bp.TIMEOUT());
        vm.prank(mum);
        bp.reclaim(orderId);
        assertEq(usdc.balanceOf(mum), 100e6);
    }

    function test_onlyOwnerCancels() public {
        uint256 id = _create(3);
        vm.prank(keeper);
        vm.expectRevert(Scheduler.NotOwner.selector);
        sch.cancel(id);
        vm.prank(mum);
        sch.cancel(id);
        vm.expectRevert(Scheduler.Inactive.selector);
        sch.execute(id);
    }

    function test_rejectsBadSchedules() public {
        vm.startPrank(mum);
        vm.expectRevert(Scheduler.InvalidSchedule.selector);
        sch.create("airtime:mtn", "08011111111", "", 0, 1 days, 3, 0); // zero amount
        vm.expectRevert(Scheduler.InvalidSchedule.selector);
        sch.create("airtime:mtn", "08011111111", "", 1e6, 59, 3, 0); // under the minimum interval
        vm.expectRevert(Scheduler.InvalidSchedule.selector);
        sch.create("airtime:mtn", "08011111111", "", 1e6, 1 days, 0, 0); // no runs
        vm.expectRevert(Scheduler.InvalidSchedule.selector);
        sch.create("airtime:mtn", "08011111111", "", 1e6, 1 days, 61, 0); // too many runs
        vm.expectRevert(Scheduler.InvalidSchedule.selector);
        sch.create("airtime:mtn", "", "", 1e6, 1 days, 3, 0); // no account
    }

    function test_futureFirstRunWaits() public {
        vm.prank(mum);
        uint256 id = sch.create("airtime:mtn", "08011111111", "bro", 1e6, 1 days, 3, uint64(block.timestamp + 2 days));
        vm.expectRevert(Scheduler.NotDue.selector);
        sch.execute(id);
        vm.warp(block.timestamp + 2 days);
        sch.execute(id);
    }

    function test_onlyTheSchedulerMayPayFor() public {
        vm.prank(keeper);
        vm.expectRevert(BillPay.NotScheduler.selector);
        bp.payFor(mum, "airtime:mtn", "08011111111", 1e6, "");
    }

    function test_schedulerCanBeSetOnlyOnceByTheOperator() public {
        BillPay fresh = new BillPay(address(usdc), operator, treasury);
        vm.prank(keeper);
        vm.expectRevert(BillPay.NotOperator.selector);
        fresh.setScheduler(address(sch));
        vm.startPrank(operator);
        fresh.setScheduler(address(sch));
        vm.expectRevert(BillPay.SchedulerAlreadySet.selector);
        fresh.setScheduler(address(0xDEAD));
    }
}
