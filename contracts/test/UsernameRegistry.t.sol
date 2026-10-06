// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {UsernameRegistry} from "../src/UsernameRegistry.sol";

contract UsernameRegistryTest is Test {
    UsernameRegistry reg;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        reg = new UsernameRegistry();
    }

    function test_registerAndResolve() public {
        vm.prank(alice);
        reg.register("ada_99");
        assertEq(reg.resolve("ada_99"), alice);
        assertEq(reg.nameOf(alice), "ada_99");
    }

    function test_revertWhenTaken() public {
        vm.prank(alice);
        reg.register("ada");
        vm.prank(bob);
        vm.expectRevert(UsernameRegistry.NameTaken.selector);
        reg.register("ada");
    }

    function test_revertWhenAddressAlreadyHasName() public {
        vm.startPrank(alice);
        reg.register("ada");
        vm.expectRevert(UsernameRegistry.AlreadyRegistered.selector);
        reg.register("ada2");
    }

    function test_revertOnInvalidNames() public {
        string[5] memory bad = ["ab", "Ada", "ada!", "a-b-c", "abcdefghijklmnopqrstu"];
        for (uint256 i; i < bad.length; i++) {
            vm.prank(alice);
            vm.expectRevert(UsernameRegistry.InvalidName.selector);
            reg.register(bad[i]);
        }
    }

    function test_resolveUnknownIsZero() public view {
        assertEq(reg.resolve("nobody"), address(0));
    }
}
