// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UsernameRegistry} from "../src/UsernameRegistry.sol";
import {BillPay} from "../src/BillPay.sol";
import {USDCPaymaster} from "../src/USDCPaymaster.sol";

/// forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_KEY
/// env: OPERATOR, TREASURY, PM_DEPOSIT_WEI (MON fronted for gas), USDC_PER_MON
contract Deploy is Script {
    address constant ENTRYPOINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address constant USDC_TESTNET = 0x534b2f3A21130d7a60830c2Df862319e593943A3;

    function run() external {
        address operator = vm.envAddress("OPERATOR");
        address treasury = vm.envAddress("TREASURY");
        uint256 deposit = vm.envOr("PM_DEPOSIT_WEI", uint256(1 ether));
        uint256 rate = vm.envOr("USDC_PER_MON", uint256(50_000));

        vm.startBroadcast();
        UsernameRegistry reg = new UsernameRegistry();
        BillPay bp = new BillPay(USDC_TESTNET, operator, treasury);
        USDCPaymaster pm = new USDCPaymaster(IEntryPoint(ENTRYPOINT_V07), IERC20(USDC_TESTNET), rate, vm.envOr("MAX_USDC_PER_MON", uint256(5_000_000)));
        pm.deposit{value: deposit}();
        vm.stopBroadcast();

        console.log("UsernameRegistry", address(reg));
        console.log("BillPay", address(bp));
        console.log("USDCPaymaster", address(pm));
    }
}
