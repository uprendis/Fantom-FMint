pragma solidity ^0.5.0;

import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IFantomMintAddressProvider.sol";
import "../interfaces/IFantomDeFiTokenStorage.sol";
import "../interfaces/IFantomMintBalanceGuard.sol";
import "../modules/FantomMintErrorCodes.sol";
import "../modules/FantomMintRewardManager.sol";

// FantomMintRewardDistribution implements the fMint rewards handling
// using RewardManager to process rewards distribution and this pool
// to unlock rewards in a defined flat rate.
//
// NOTE: Unlocked rewards can be pushed into the distribution by anyone,
// participants are motivated to do so to be able to gain
// the rewards they earned.
contract FantomMintRewardDistribution is Ownable, FantomMintRewardManager
{
    // define used libs
    using SafeMath for uint256;
    using Address for address;

    // ---------------------------------------------------------------------
    // Reward distribution constants
    // ---------------------------------------------------------------------

    // MinRewardPushInterval represents the minimal amount of time between
    // two consecutive reward push calls.
    uint256 public constant minRewardPushInterval = 2 days;

    // ---------------------------------------------------------------------
    // State variables
    // ---------------------------------------------------------------------

    // addressProvider represents the connection to other FMint related
    // contracts.
    IFantomMintAddressProvider public addressProvider;

    // lastRewardPush represents the time stamp of the latest reward
    // distribution event.
    uint256 public lastRewardPush;

    // rewardPerSecond represents the rate of rewards being unlocked every
    // second from the reward pool.
    uint256 public rewardPerSecond;

    // ---------------------------------------------------------------------
    // Events emitted
    // ---------------------------------------------------------------------
    event RateUpdated(uint256 rewardPerYear);

    // ---------------------------------------------------------------------
    // Instance management and utility functions
    // ---------------------------------------------------------------------

    // create instance of the reward distribution
    constructor (address _addressProvider) public {
        // remember the address provider for the other protocol contracts connection
        addressProvider = IFantomMintAddressProvider(_addressProvider);
    }

    // ---------------------------------------------------------------------
    // Rewards control & rewards distribution functions
    // ---------------------------------------------------------------------

    // mustRewardPush (wrapper) does the reward push and reverts if the attempt fails.
    function mustRewardPush() public {
        // make the move
        uint256 result = rewardPush();

        // check too early condition
        require(result != ERR_REWARDS_EARLY, "too early for a rewards push");

        // check no rewards unlocked condition
        require(result != ERR_REWARDS_NONE, "no rewards unclocked");

        // check reward account balance low condition
        require(result != ERR_REWARDS_DEPLETED, "rewards depleted");

        // sanity check for any non-covered condition
        require(result == ERR_NO_ERROR, "unexpected failure");
    }

    // rewardPush verifies the reward distribution conditions and calculates
    // available reward amount; if the call is legit, it will push the reward
    // to the Rewards Manager module to be distributed.
    // NOTE: We don't restrict the call source since it doesn't matter who makes
    // the call, all the calculations are done inside.
    function rewardPush() public returns(uint256) {
    	// check if enough time passed from the last distribution
    	if (now < lastRewardPush.add(minRewardPushInterval)) {
    		return ERR_REWARDS_EARLY;
    	}

    	// how much is unlocked and waiting in the reward pool?
    	uint256 amount = now.sub(lastRewardPush).mul(rewardPerSecond);
    	if (amount == 0) {
    		return ERR_REWARDS_NONE;
    	}

    	// check the manager account balance on the reward pool
    	// to make sure these rewards can be distributed
    	if (amount > IERC20(rewardTokenAddress()).balanceOf(address(this))) {
    		return ERR_REWARDS_DEPLETED;
    	}

    	// update the time stamp
    	lastRewardPush = now;

    	// notify the amount to the Reward Management (internal call)
    	rewardNotifyAmount(amount);

        // all done
        return ERR_NO_ERROR;
    }

    // updateRate modifies the amount of reward unlocked per second
    function updateRate(uint256 _perSecond) external onlyOwner {
    	// make sure the amount makes sense
    	require(_perSecond > 0, "invalid reward rate");

    	// store new value for rewards per second
    	rewardPerSecond = _perSecond;

    	// notify the change
    	emit RateUpdated(_perSecond);
    }

    // ---------------------------------------------------------------------
    // Required external connections and calls for the rewards manager
    // ---------------------------------------------------------------------

    // principalBalance returns the total balance of principal token
    // which yield a reward to entitled participants based
    // on their individual principal share.
    function principalBalance() public view returns (uint256) {
        return IFantomDeFiTokenStorage(addressProvider.getDebtPool()).total();
    }

    // principalBalanceOf returns the balance of principal token
    // which yield a reward share for this account.
    function principalBalanceOf(address _account) public view returns (uint256) {
        return IFantomDeFiTokenStorage(addressProvider.getDebtPool()).totalOf(_account);
    }

    // rewardTokenAddress returns address of the reward ERC20 token.
    function rewardTokenAddress() public view returns (address) {
        return addressProvider.getRewardToken();
    }

    // rewardCanClaim checks if the account can claim accumulated reward.
    function rewardCanClaim(address _account) public view returns (bool) {
        return IFantomMintBalanceGuard(addressProvider.getFantomMint()).rewardCanClaim(_account);
    }

    // rewardIsEligible checks if the account is eligible to receive any reward.
    function rewardIsEligible(address _account) internal view returns (bool) {
        return IFantomMintBalanceGuard(addressProvider.getFantomMint()).rewardIsEligible(_account);
    }
}