// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Escrows USDC per bill order. Funds reach the treasury only with a fulfilment
/// reference; otherwise they go back to the payer (operator refund or payer reclaim after TIMEOUT).
contract BillPay {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Pending,
        Fulfilled,
        Refunded
    }

    struct Order {
        address payer;
        uint96 amount;
        uint64 createdAt;
        Status status;
    }

    error ZeroAmount();
    error NotOperator();
    error NotPayer();
    error NotPending();
    error EmptyReference();
    error TooEarly();

    event BillRequested(
        uint256 indexed orderId,
        address indexed payer,
        string billType,
        string account,
        uint256 amount,
        string beneficiary
    );
    event BillFulfilled(uint256 indexed orderId, string ref);
    event BillRefunded(uint256 indexed orderId);

    uint256 public constant TIMEOUT = 1 hours;

    IERC20 public immutable usdc;
    address public immutable operator;
    address public immutable treasury;

    uint256 public nextId = 1;
    mapping(uint256 => Order) public orders;

    constructor(address usdc_, address operator_, address treasury_) {
        usdc = IERC20(usdc_);
        operator = operator_;
        treasury = treasury_;
    }

    /// @param beneficiary @username the bill is paid for ("" = self). Display only.
    function pay(string calldata billType, string calldata account, uint96 amount, string calldata beneficiary)
        external
        returns (uint256 id)
    {
        if (amount == 0) revert ZeroAmount();
        id = nextId++;
        orders[id] = Order(msg.sender, amount, uint64(block.timestamp), Status.Pending);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit BillRequested(id, msg.sender, billType, account, amount, beneficiary);
    }

    function fulfill(uint256 id, string calldata ref) external {
        if (msg.sender != operator) revert NotOperator();
        if (bytes(ref).length == 0) revert EmptyReference();
        Order storage o = _pending(id);
        o.status = Status.Fulfilled;
        usdc.safeTransfer(treasury, o.amount);
        emit BillFulfilled(id, ref);
    }

    function refund(uint256 id) external {
        if (msg.sender != operator) revert NotOperator();
        _refund(_pending(id), id);
    }

    function reclaim(uint256 id) external {
        Order storage o = _pending(id);
        if (msg.sender != o.payer) revert NotPayer();
        if (block.timestamp < o.createdAt + TIMEOUT) revert TooEarly();
        _refund(o, id);
    }

    function _pending(uint256 id) private view returns (Order storage o) {
        o = orders[id];
        if (o.status != Status.Pending) revert NotPending();
    }

    function _refund(Order storage o, uint256 id) private {
        o.status = Status.Refunded;
        usdc.safeTransfer(o.payer, o.amount);
        emit BillRefunded(id);
    }
}
