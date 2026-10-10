// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {BillProfile} from "../src/BillProfile.sol";

contract BillProfileTest is Test {
    BillProfile p;
    address mum = address(0xAA);
    address other = address(0xBB);

    function setUp() public {
        p = new BillProfile();
    }

    function test_setAndGetPublicly() public {
        vm.prank(mum);
        p.set("electricity", "ikeja-electric", "prepaid", "45012345678");
        BillProfile.Detail memory d = p.get(mum, "electricity"); // anyone can read
        assertEq(d.provider, "ikeja-electric");
        assertEq(d.plan, "prepaid");
        assertEq(d.account, "45012345678");
    }

    function test_categoriesAreIndependent() public {
        vm.startPrank(mum);
        p.set("airtime", "mtn", "", "08011111111");
        p.set("tv", "dstv", "", "1212121212");
        vm.stopPrank();
        assertEq(p.get(mum, "airtime").account, "08011111111");
        assertEq(p.get(mum, "tv").account, "1212121212");
        assertEq(p.get(mum, "data").account, ""); // nothing saved
    }

    function test_onlyOwnerWritesTheirOwnEntry() public {
        vm.prank(mum);
        p.set("airtime", "mtn", "", "08011111111");
        vm.prank(other);
        p.set("airtime", "glo", "", "08022222222");
        assertEq(p.get(mum, "airtime").provider, "mtn"); // other could not overwrite mum's
        assertEq(p.get(other, "airtime").provider, "glo");
    }

    function test_overwriteAndClear() public {
        vm.startPrank(mum);
        p.set("airtime", "mtn", "", "08011111111");
        p.set("airtime", "airtel", "", "08099999999");
        assertEq(p.get(mum, "airtime").provider, "airtel");
        p.clear("airtime");
        assertEq(p.get(mum, "airtime").account, "");
    }

    function test_rejectsBadInput() public {
        vm.startPrank(mum);
        vm.expectRevert(BillProfile.InvalidCategory.selector);
        p.set("gift", "x", "", "1");
        vm.expectRevert(BillProfile.InvalidCategory.selector);
        p.get(mum, "nope");
        vm.expectRevert(BillProfile.EmptyAccount.selector);
        p.set("airtime", "mtn", "", "");
        vm.expectRevert(BillProfile.EmptyAccount.selector);
        p.set("airtime", "", "", "08011111111");
        vm.expectRevert(BillProfile.TooLong.selector);
        p.set("airtime", "mtn", "", "01234567890123456789012345678901234567890"); // 41 chars
    }
}
