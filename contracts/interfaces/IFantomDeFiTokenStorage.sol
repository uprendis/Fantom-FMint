pragma solidity ^0.5.0;

// IFantomDeFiTokenStorage defines the interface to token storage contract
// used by the DeFi protocol to manage collateral and debt pools.
interface IFantomDeFiTokenStorage {
    // tokenValue returns the value of the given amount of the token specified.
    function tokenValue(address _token, uint256 _amount) external view returns (uint256);

    // total returns the total value of all the tokens registered inside the storage.
    function total() external view returns (uint256);

    // totalOf returns the value of current balance of specified account.
    function totalOf(address _account) external view returns (uint256);

    // totalOfAfterAdd returns the value of current balance of specified account after adding specified tokens.
    function totalOfAfterAdd(address _account, address _addToken, uint256 _addAmount) external view returns (uint256);

    // totalOfAfterSub returns the value of current balance of specified account after subtracting specified tokens.
    function totalOfAfterSub(address _account, address _subToken, uint256 _subAmount) external view returns (uint256);

    // balanceOf returns the balance of the given token on the given account.
    function balanceOf(address _account, address _token) external view returns (uint256);

    // add adds specified amount of tokens to given account.
    function add(address _account, address _token, uint256 _amount) external;

    // sub removes specified amount of tokens from given account.
    function sub(address _account, address _token, uint256 _amount) external;
}