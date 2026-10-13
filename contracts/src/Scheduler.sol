// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IBillPay {
    function payFor(
        address payer,
        string calldata billType,
        string calldata account,
        uint96 amount,
        string calldata beneficiary
    ) external returns (uint256);
}

/// @notice Recurring bills. An account registers "pay this bill every N seconds, M times"; anyone can trigger a
/// due run. A run can only spend what the account approved to BillPay, and can only go to the stored bill, so
/// triggering it is harmless. Refunds return to the account because BillPay records the account as the payer.
contract Scheduler {
    error InvalidSchedule();
    error NotOwner();
    error NotDue();
    error Inactive();

    struct Schedule {
        address owner;
        uint96 amount; // USDC base units per run
        uint32 interval; // seconds between runs
        uint64 nextDue;
        uint16 runsLeft;
        string billType; // "category:provider[:plan]", see app/lib/bills.ts
        string account; // phone or meter number
        string beneficiary; // display label, e.g. "mum"
    }

    event ScheduleCreated(
        uint256 indexed id,
        address indexed owner,
        string billType,
        string account,
        string beneficiary,
        uint96 amount,
        uint32 interval,
        uint16 runs,
        uint64 firstDue
    );
    event ScheduleRun(uint256 indexed id, uint256 indexed orderId, uint16 runsLeft);
    event ScheduleCancelled(uint256 indexed id);

    uint32 public constant MIN_INTERVAL = 60; // ponytail: 1 minute so a demo can show a repeat; use a day or more in production
    uint16 public constant MAX_RUNS = 60;
    uint256 public constant MAX_STR = 64;

    IBillPay public immutable billPay;
    uint256 public nextId = 1;
    mapping(uint256 => Schedule) private _s;

    constructor(IBillPay billPay_) {
        billPay = billPay_;
    }

    /// @param firstDue unix time of the first run; anything in the past means "now".
    function create(
        string calldata billType,
        string calldata account,
        string calldata beneficiary,
        uint96 amount,
        uint32 interval,
        uint16 runs,
        uint64 firstDue
    ) external returns (uint256 id) {
        if (
            amount == 0 || interval < MIN_INTERVAL || runs == 0 || runs > MAX_RUNS || bytes(billType).length == 0
                || bytes(account).length == 0 || bytes(billType).length > MAX_STR || bytes(account).length > MAX_STR
                || bytes(beneficiary).length > MAX_STR
        ) revert InvalidSchedule();
        if (firstDue < block.timestamp) firstDue = uint64(block.timestamp);
        id = nextId++;
        _s[id] = Schedule(msg.sender, amount, interval, firstDue, runs, billType, account, beneficiary);
        emit ScheduleCreated(id, msg.sender, billType, account, beneficiary, amount, interval, runs, firstDue);
    }

    /// Permissionless: runs the next payment if it is due.
    function execute(uint256 id) external returns (uint256 orderId) {
        Schedule storage s = _s[id];
        if (s.runsLeft == 0) revert Inactive();
        if (block.timestamp < s.nextDue) revert NotDue();
        s.runsLeft -= 1;
        s.nextDue = uint64(block.timestamp) + s.interval;
        orderId = billPay.payFor(s.owner, s.billType, s.account, s.amount, s.beneficiary);
        emit ScheduleRun(id, orderId, s.runsLeft);
    }

    function cancel(uint256 id) external {
        if (_s[id].owner != msg.sender) revert NotOwner();
        delete _s[id];
        emit ScheduleCancelled(id);
    }

    function get(uint256 id) external view returns (Schedule memory) {
        return _s[id];
    }
}
