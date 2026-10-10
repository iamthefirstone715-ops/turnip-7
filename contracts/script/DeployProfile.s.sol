// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {BillProfile} from "../src/BillProfile.sol";

/// forge script script/DeployProfile.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_KEY
contract DeployProfile is Script {
    function run() external {
        vm.startBroadcast();
        BillProfile p = new BillProfile();
        vm.stopBroadcast();
        console.log("BillProfile", address(p));
    }
}
