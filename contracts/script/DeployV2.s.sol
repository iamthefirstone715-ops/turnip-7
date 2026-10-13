// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {BillPay} from "../src/BillPay.sol";
import {Scheduler, IBillPay} from "../src/Scheduler.sol";

/// Deploys BillPay v2 and the Scheduler. Then the operator key must wire them once:
/// cast send $BILLPAY "setScheduler(address)" $SCHEDULER --private-key $OPERATOR_KEY
/// env: OPERATOR, TREASURY
contract DeployV2 is Script {
    address constant USDC_TESTNET = 0x534b2f3A21130d7a60830c2Df862319e593943A3;

    function run() external {
        vm.startBroadcast();
        BillPay bp = new BillPay(USDC_TESTNET, vm.envAddress("OPERATOR"), vm.envAddress("TREASURY"));
        Scheduler sch = new Scheduler(IBillPay(address(bp)));
        vm.stopBroadcast();
        console.log("BillPayV2", address(bp));
        console.log("Scheduler", address(sch));
    }
}
