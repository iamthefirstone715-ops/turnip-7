// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {USDCPaymaster} from "../src/USDCPaymaster.sol";

/// Deploys the paymaster, funds its gas deposit and stakes it (bundlers require a stake because it moves USDC in validation).
/// env (optional): USDC_PER_MON, MAX_USDC_PER_MON, PM_DEPOSIT_WEI, PM_STAKE_WEI, PM_UNSTAKE_DELAY
contract DeployPaymaster is Script {
    address constant ENTRYPOINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address constant USDC_TESTNET = 0x534b2f3A21130d7a60830c2Df862319e593943A3;

    function run() external {
        vm.startBroadcast();
        USDCPaymaster pm = new USDCPaymaster(
            IEntryPoint(ENTRYPOINT_V07),
            IERC20(USDC_TESTNET),
            vm.envOr("USDC_PER_MON", uint256(50_000)),
            vm.envOr("MAX_USDC_PER_MON", uint256(5_000_000))
        );
        pm.deposit{value: vm.envOr("PM_DEPOSIT_WEI", uint256(1 ether))}();
        pm.addStake{value: vm.envOr("PM_STAKE_WEI", uint256(0.5 ether))}(uint32(vm.envOr("PM_UNSTAKE_DELAY", uint256(86_400))));
        vm.stopBroadcast();
        console.log("USDCPaymaster", address(pm));
    }
}
