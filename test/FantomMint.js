const {
    BN,
    expectRevert,
    time,
} = require('openzeppelin-test-helpers');
const {expect} = require('chai');

const FantomMintAddressProvider = artifacts.require('FantomMintAddressProvider');
const FantomDeFiTokenStorage = artifacts.require('FantomDeFiTokenStorage');
const FantomMintTokenRegistry = artifacts.require('FantomMintTokenRegistry');
const FantomMintRewardDistribution = artifacts.require('TestFantomMintRewardDistribution');
const TestPriceOracle = artifacts.require('TestPriceOracle');
const FantomMint = artifacts.require('FantomMint');
const TestToken = artifacts.require('TestToken');

function amount18(n) {
    return new BN(web3.utils.toWei(n, 'ether'));
}

function amount0(n) {
    return new BN(web3.utils.toWei(n, 'wei'));
}

function ratio8(n) {
    return new BN(web3.utils.toWei(n, 'gwei')).div(new BN('10'));
}

function ratio18(n) {
    return new BN(web3.utils.toWei(n, 'ether'));
}

function ratio4(n) {
    return new BN(web3.utils.toWei(n, 'mwei')).div(new BN('100'));
}

const wei1 = amount0('1');
const wei2 = amount0('2');
const wei3 = amount0('3');

async function binarySearchMaxTrue(start, end, fn) {
    let startVal = await fn(start);
    if (!startVal) {
        return new BN('-1');
    }
    let endVal = await fn(end);
    if (endVal) {
        return new BN('-1');
    }
    if (end.sub(start).lten(1)) {
        return start;
    }
    let mid = start.add(end.sub(start).divn(2));
    let midVal = await fn(mid);
    //console.log('start', web3.utils.fromWei(start, "ether"), await fn(start))
    //console.log('end', web3.utils.fromWei(end, "ether"), await fn(end))
    //console.log('mid', web3.utils.fromWei(mid, "ether"), midVal)
    if (midVal) {
        return await binarySearchMaxTrue(mid, end, fn);
    } else {
        return await binarySearchMaxTrue(start, mid, fn);
    }
}

function cached(fn) {
    var cache = new Map();
    return async function(arg) {
        //key = web3.utils.fromWei(arg, "wei")
        if (cache.has(arg)) {
            return cache.get(arg);
        }
        const res = fn(arg);
        cache.set(arg, res);
        return res;
    }
}

async function findMaxWithdrawable(fmint, depositor, token, start, maxToCheck) {
    let sample = async function (amount) {
        try {
            return await fmint.collateralCanDecrease(depositor, token, amount);
        }
        catch (error) {
            return false;
        }
    }
    let res = await binarySearchMaxTrue(start, start.add(maxToCheck), cached(sample));
    // sanity check
    let test = await fmint.maxToWithdraw(depositor, token, ratio4('3.0'));
    if (res.lt(test)) {
        throw "maxToWithdraw is bigger than collateralCanDecrease";
    }
    return res;
}

async function findMaxMintable(fmint, depositor, token, start, maxToCheck) {
    let sample = async function (amount) {
        try {
            return await fmint.debtCanIncrease(depositor, token, amount);
        }
        catch (error) {
            return false;
        }
    }
    let res = await binarySearchMaxTrue(start, start.add(maxToCheck), cached(sample));
    // sanity check
    let test = await fmint.maxToMint(depositor, token, ratio4('3.0'));
    if (res.lt(test)) {
        throw "maxToMint is bigger than debtCanIncrease";
    }
    return res;
}

function randBig(seed) {
    seed = seed.xor(seed.shln(210));
    seed = seed.xor(seed.shrn(350));
    seed = seed.xor(seed.shln(40));
    seed = seed.xor(seed.shln(50));
    seed = seed.xor(seed.shrn(90));
    seed = seed.xor(seed.shln(10));
    seed = seed.xor(seed.shln(21));
    seed = seed.xor(seed.shrn(35));
    seed = seed.xor(seed.shln(4));
    return seed.mod(new BN('115792089237316195423570985008687907853269984665640564039457584007913129639935'));
}

contract('FantomMint test', async ([defaultAcc, depositor1, depositor2, depositor3]) => {
    beforeEach(async () => {
        this.addressProvider = await FantomMintAddressProvider.new();
        this.addressProvider.initialize(defaultAcc);
        this.tokenRegistry = await FantomMintTokenRegistry.new();
        this.tokenRegistry.initialize(defaultAcc);
        this.priceOracle = await TestPriceOracle.new();

        this.tkn0 = await TestToken.new();
        this.tkn0.initialize("tkn0", "tkn0", 1);
        this.tkn18 = await TestToken.new(18);
        this.tkn18.initialize("tkn18", "tkn18", 18);
        this.tknStable18 = await TestToken.new(18);
        this.tknStable18.initialize("tknStable18", "tknStable18", 18);
        this.tknReward18 = await TestToken.new(18);
        this.tknReward18.initialize("tknReward18", "tknReward18", 18);

        this.rewarder = await FantomMintRewardDistribution.new();
        this.rewarder.initialize(defaultAcc, this.addressProvider.address);
        this.fmint = await FantomMint.new();
        this.fmint.initialize(defaultAcc, this.addressProvider.address);
        this.debtPool = await FantomDeFiTokenStorage.new();
        this.debtPool.initialize(this.addressProvider.address, true);
        this.collateralPool = await FantomDeFiTokenStorage.new();
        this.collateralPool.initialize(this.addressProvider.address, false);

        await this.addressProvider.setTokenRegistry(this.tokenRegistry.address);
        await this.addressProvider.setRewardDistribution(this.rewarder.address);
        await this.addressProvider.setPriceOracleProxy(this.priceOracle.address);
        await this.addressProvider.setRewardToken(this.tknReward18.address);
        await this.addressProvider.setFantomMint(this.fmint.address);
        await this.addressProvider.setDebtPool(this.debtPool.address);
        await this.addressProvider.setCollateralPool(this.collateralPool.address);

        await this.tokenRegistry.addToken(this.tkn0.address, "", this.priceOracle.address, 8, true, true, false);
        await this.tokenRegistry.addToken(this.tkn18.address, "", this.priceOracle.address, 8, true, true, false);
        await this.tokenRegistry.addToken(this.tknStable18.address, "", this.priceOracle.address, 8, true, false, true);
    });

    it('checking single deposit', async () => {
        // deposit
        await expectRevert(this.fmint.mustDeposit(this.tkn0.address, amount0('0'), {from: depositor1}), 'non-zero amount expected');
        await expectRevert(this.fmint.mustDeposit(this.tkn0.address, amount0('1'), {from: depositor1}), 'insufficient token balance');
        await this.tkn0.mint(depositor1, amount0('1'));
        await expectRevert(this.fmint.mustDeposit(this.tkn0.address, amount0('1'), {from: depositor1}), 'insufficient allowance');
        await this.tkn0.approve(this.fmint.address, amount0('1'), {from: depositor1});
        await expectRevert(this.fmint.mustDeposit(this.tkn0.address, amount0('1'), {from: depositor1}), 'token has no value');
        await this.priceOracle.setPrice(this.tkn0.address, ratio8('0.00000001'));
        await this.fmint.mustDeposit(this.tkn0.address, amount0('1'), {from: depositor1});

        expect(await this.tkn0.balanceOf(depositor1)).to.be.bignumber.equal(amount0('0'));

        // zero collateral value, because price is too small
        expect(await this.collateralPool.tokenValue(this.tkn0.address, amount0('1'))).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        // set price 1.0
        await this.priceOracle.setPrice(this.tkn0.address, ratio8("1.0"));
        expect(await this.collateralPool.tokenValue(this.tkn0.address, amount0('1'))).to.be.bignumber.equal(amount0('1'));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('1'));
        // set a huge price
        await this.priceOracle.setPrice(this.tkn0.address, ratio8("1000000000000000000000000.0"));
        expect(await this.collateralPool.tokenValue(this.tkn0.address, amount0('1'))).to.be.bignumber.equal(amount0('1000000000000000000000000'));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.total()).to.be.bignumber.equal(amount0('0'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('1000000000000000000000000'));
        expect(await this.collateralPool.total()).to.be.bignumber.equal(amount0('1000000000000000000000000'));
    });

    it('checking multiple deposits', async () => {
        await this.priceOracle.setPrice(this.tkn0.address, ratio8("100000.12345678"));
        // deposit
        await expectRevert(this.fmint.mustDeposit(this.tkn0.address, amount0('0'), {from: depositor1}), 'non-zero amount expected');
        await expectRevert(this.fmint.mustDeposit(this.tkn0.address, amount0('1'), {from: depositor1}), 'insufficient token balance');
        await this.tkn0.mint(depositor1, amount0('1'));
        await expectRevert(this.fmint.mustDeposit(this.tkn0.address, amount0('1'), {from: depositor1}), 'insufficient allowance');
        await this.tkn0.approve(this.fmint.address, amount0('1'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn0.address, amount0('1'), {from: depositor1});

        expect(await this.tkn0.balanceOf(depositor1)).to.be.bignumber.equal(amount0('0'));

        expect(await this.collateralPool.tokenValue(this.tkn0.address, amount0('1'))).to.be.bignumber.equal(amount0('100000'));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.total()).to.be.bignumber.equal(amount0('0'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('100000'));
        expect(await this.collateralPool.total()).to.be.bignumber.equal(amount0('100000'));

        // increase deposition
        await expectRevert(this.fmint.mustDeposit(this.tkn0.address, amount0('0'), {from: depositor1}), 'non-zero amount expected');
        await expectRevert(this.fmint.mustDeposit(this.tkn0.address, amount0('100'), {from: depositor1}), 'insufficient token balance');
        await this.tkn0.mint(depositor1, amount0('1000'));
        await expectRevert(this.fmint.mustDeposit(this.tkn0.address, amount0('100'), {from: depositor1}), 'insufficient allowance');
        await this.tkn0.approve(this.fmint.address, amount0('500'), {from: depositor1});
        await expectRevert(this.fmint.mustDeposit(this.tkn0.address, amount0('501'), {from: depositor1}), 'insufficient allowance');
        await this.priceOracle.setPrice(this.tkn0.address, ratio8("0.0"));
        await expectRevert(this.fmint.mustDeposit(this.tkn0.address, amount0('100'), {from: depositor1}), 'token has no value');
        await this.priceOracle.setPrice(this.tkn0.address, ratio8("100000.12345678"));
        // approval is higher than deposited amount
        await this.fmint.mustDeposit(this.tkn0.address, amount0('100'), {from: depositor1});

        // didn't transfer the surplus allowed balance
        expect(await this.tkn0.balanceOf(depositor1)).to.be.bignumber.equal(amount0('900'));

        expect(await this.collateralPool.tokenValue(this.tkn0.address, amount0('101'))).to.be.bignumber.equal(amount0('10100012'));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.total()).to.be.bignumber.equal(amount0('0'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('10100012'));
        expect(await this.collateralPool.total()).to.be.bignumber.equal(amount0('10100012'));

        // add tkn18 to the deposit
        await expectRevert(this.fmint.mustDeposit(this.tkn18.address, amount18('0'), {from: depositor1}), 'non-zero amount expected');
        await expectRevert(this.fmint.mustDeposit(this.tkn18.address, amount18('500000000000000'), {from: depositor1}), 'insufficient token balance');
        await this.tkn18.mint(depositor1, amount18('500000000000000'));
        await expectRevert(this.fmint.mustDeposit(this.tkn18.address, amount18('500000000000000'), {from: depositor1}), 'insufficient allowance');
        await this.tkn18.approve(this.fmint.address, amount18('500000000000000'), {from: depositor1});
        await expectRevert(this.fmint.mustDeposit(this.tkn18.address, amount18('500000000000001'), {from: depositor1}), 'insufficient token balance');
        await expectRevert(this.fmint.mustDeposit(this.tkn18.address, amount18('500000000000000'), {from: depositor1}), 'token has no value');
        await this.priceOracle.setPrice(this.tkn18.address, ratio8("0.00005678"));
        await this.fmint.mustDeposit(this.tkn18.address, amount18('500000000000000'), {from: depositor1});

        expect(await this.tkn0.balanceOf(depositor1)).to.be.bignumber.equal(amount0('900'));
        expect(await this.tkn18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('0.0'));

        expect(await this.collateralPool.tokenValue(this.tkn18.address, amount18('500000000000000'))).to.be.bignumber.equal(amount18('28390000000.0'));
        expect(await this.collateralPool.tokenValue(this.tkn0.address, amount0('101'))).to.be.bignumber.equal(amount0('10100012'));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.total()).to.be.bignumber.equal(amount0('0'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('10100012').add(amount18('28390000000.0')));
        expect(await this.collateralPool.total()).to.be.bignumber.equal(amount0('10100012').add(amount18('28390000000.0')));

        // create second deposit
        await expectRevert(this.fmint.mustDeposit(this.tkn18.address, amount18('0'), {from: depositor2}), 'non-zero amount expected');
        await expectRevert(this.fmint.mustDeposit(this.tkn18.address, amount18('3000'), {from: depositor2}), 'insufficient token balance');
        await this.tkn18.mint(depositor2, amount18('5000'));
        await expectRevert(this.fmint.mustDeposit(this.tkn18.address, amount18('3000'), {from: depositor2}), 'insufficient allowance');
        await this.tkn18.approve(this.fmint.address, amount18('3000'), {from: depositor2});
        await expectRevert(this.fmint.mustDeposit(this.tkn18.address, amount18('3000.0000000000000001'), {from: depositor2}), 'insufficient allowance');
        await this.fmint.mustDeposit(this.tkn18.address, amount18('3000'), {from: depositor2});

        expect(await this.tkn0.balanceOf(depositor1)).to.be.bignumber.equal(amount0('900'));
        expect(await this.tkn18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.tkn18.balanceOf(depositor2)).to.be.bignumber.equal(amount18('2000.0'));

        expect(await this.collateralPool.tokenValue(this.tkn18.address, amount18('3000'))).to.be.bignumber.equal(amount18('0.17034'));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.total()).to.be.bignumber.equal(amount0('0'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('10100012').add(amount18('28390000000.0')));
        expect(await this.collateralPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('0.17034'));
        expect(await this.collateralPool.total()).to.be.bignumber.equal(amount0('10100012').add(amount18('28390000000.0')).add(amount18('0.17034')));

        // increase first deposit
        await this.tkn0.approve(this.fmint.address, amount0('900'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn0.address, amount0('900'), {from: depositor1});
        await this.tkn18.approve(this.fmint.address, amount18('2000'), {from: depositor2});
        await this.fmint.mustDeposit(this.tkn18.address, amount18('2000'), {from: depositor2});
        // change prices
        await this.priceOracle.setPrice(this.tkn0.address, ratio8("87654321.87654321"));
        await this.priceOracle.setPrice(this.tkn18.address, ratio8("1.12345678"));

        expect(await this.tkn0.balanceOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.tkn18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.tkn18.balanceOf(depositor2)).to.be.bignumber.equal(amount18('0.0'));

        expect(await this.collateralPool.tokenValue(this.tkn18.address, amount18('500000000000000'))).to.be.bignumber.equal(amount18('561728390000000.0'));
        expect(await this.collateralPool.tokenValue(this.tkn18.address, amount18('5000'))).to.be.bignumber.equal(amount18('5617.2839'));
        expect(await this.collateralPool.tokenValue(this.tkn0.address, amount0('1001'))).to.be.bignumber.equal(amount0('87741976198'));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.totalOf(depositor2)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.total()).to.be.bignumber.equal(amount0('0'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('87741976198').add(amount18('561728390000000.0')));
        expect(await this.collateralPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('5617.2839'));
        expect(await this.collateralPool.total()).to.be.bignumber.equal(amount0('87741976198').add(amount18('561728390000000.0')).add(amount18('5617.2839')));
    });

    it('checking single withdrawal', async () => {
        await this.priceOracle.setPrice(this.tkn0.address, ratio8('2.0'));

        await this.tkn0.mint(depositor1, amount0('1'));
        await this.tkn0.approve(this.fmint.address, amount0('1'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn0.address, amount0('1'), {from: depositor1});

        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('0'), {from: depositor1}), 'non-zero amount expected');
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('2'), {from: depositor1}), 'insufficient collateral balance');
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, amount0('1'), {from: depositor1}), 'insufficient collateral balance');
        await this.fmint.mustWithdraw(this.tkn0.address, amount0('1'), {from: depositor1});
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('1'), {from: depositor1}), 'insufficient collateral balance');

        expect(await this.tkn0.balanceOf(depositor1)).to.be.bignumber.equal(amount0('1'));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
    })

    it('checking multiple withdrawals', async () => {
        await this.priceOracle.setPrice(this.tkn0.address, ratio8('87654321.87654321'));
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('0.12345678'));
        // deposit 2 tokens
        await this.tkn0.mint(depositor1, amount0('100'));
        await this.tkn0.approve(this.fmint.address, amount0('100'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn0.address, amount0('100'), {from: depositor1});

        await this.tkn18.mint(depositor1, amount18('500.123456789123456789'));
        await this.tkn18.approve(this.fmint.address, amount18('500.123456789123456789'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn18.address, amount18('500.123456789123456789'), {from: depositor1});

        // deposit from a second address
        await this.tkn18.mint(depositor2, amount18('200.0'));
        await this.tkn18.approve(this.fmint.address, amount18('200.0'), {from: depositor2});
        await this.fmint.mustDeposit(this.tkn18.address, amount18('200.0'), {from: depositor2});

        expect(await this.collateralPool.tokenValue(this.tkn18.address, amount18('500.123456789123456789'))).to.be.bignumber.equal(amount18('61.743631577654320997'));
        expect(await this.collateralPool.tokenValue(this.tkn18.address, amount18('200.0'))).to.be.bignumber.equal(amount18('24.691356'));
        expect(await this.collateralPool.tokenValue(this.tkn0.address, amount0('100'))).to.be.bignumber.equal(amount0('8765432187'));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.totalOf(depositor2)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.total()).to.be.bignumber.equal(amount0('0'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('8765432187').add(amount18('61.743631577654320997')));
        expect(await this.collateralPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('24.691356'));
        expect(await this.collateralPool.total()).to.be.bignumber.equal(amount0('8765432187').add(amount18('61.743631577654320997')).add(amount18('24.691356')));

        // partially withdraw tkn0 collateral
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('0'), {from: depositor1}), 'non-zero amount expected');
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('101'), {from: depositor1}), 'insufficient collateral balance');
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('1'), {from: depositor2}), 'insufficient collateral balance');
        await this.fmint.mustWithdraw(this.tkn0.address, amount0('1'), {from: depositor1});
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('100'), {from: depositor1}), 'insufficient collateral balance');

        expect(await this.tkn0.balanceOf(depositor1)).to.be.bignumber.equal(amount0('1'));

        expect(await this.collateralPool.tokenValue(this.tkn0.address, amount0('99'))).to.be.bignumber.equal(amount0('8677777865'));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.totalOf(depositor2)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.total()).to.be.bignumber.equal(amount0('0'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('8677777865').add(amount18('61.743631577654320997')));
        expect(await this.collateralPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('24.691356'));
        expect(await this.collateralPool.total()).to.be.bignumber.equal(amount0('8677777865').add(amount18('61.743631577654320997')).add(amount18('24.691356')));

        // fully withdraw tkn18 collateral
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, amount18('0'), {from: depositor2}), 'non-zero amount expected');
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, amount18('200.000000000000000001'), {from: depositor2}), 'insufficient collateral balance');
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount18('200.0'), {from: depositor2}), 'insufficient collateral balance');
        await this.fmint.mustWithdraw(this.tkn18.address, amount18('200.0'), {from: depositor2});
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, amount18('200.0'), {from: depositor2}), 'insufficient collateral balance');

        expect(await this.tkn0.balanceOf(depositor1)).to.be.bignumber.equal(amount0('1'));
        expect(await this.tkn18.balanceOf(depositor2)).to.be.bignumber.equal(amount18('200.0'));

        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.totalOf(depositor2)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.total()).to.be.bignumber.equal(amount0('0'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('8677777865').add(amount18('61.743631577654320997')));
        expect(await this.collateralPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.collateralPool.total()).to.be.bignumber.equal(amount0('8677777865').add(amount18('61.743631577654320997')));

        // re-deposit partially withdraw tkn0 collateral
        await this.tkn0.approve(this.fmint.address, amount0('1'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn0.address, amount0('1'), {from: depositor1});

        expect(await this.tkn0.balanceOf(depositor1)).to.be.bignumber.equal(amount0('0'));

        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.totalOf(depositor2)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.total()).to.be.bignumber.equal(amount0('0'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('8765432187').add(amount18('61.743631577654320997')));
        expect(await this.collateralPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.collateralPool.total()).to.be.bignumber.equal(amount0('8765432187').add(amount18('61.743631577654320997')));

        // change prices
        await this.priceOracle.setPrice(this.tkn0.address, ratio8('1.0'));
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('1.0'));

        expect(await this.tkn0.balanceOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.tkn18.balanceOf(depositor2)).to.be.bignumber.equal(amount18('200.0'));

        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.totalOf(depositor2)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.total()).to.be.bignumber.equal(amount0('0'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('100').add(amount18('500.123456789123456789')));
        expect(await this.collateralPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.collateralPool.total()).to.be.bignumber.equal(amount0('100').add(amount18('500.123456789123456789')));

        // withdraw all
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('0'), {from: depositor1}), 'non-zero amount expected');
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('101'), {from: depositor1}), 'insufficient collateral balance');
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('1'), {from: depositor2}), 'insufficient collateral balance');
        await this.fmint.mustWithdraw(this.tkn0.address, amount0('100'), {from: depositor1});
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('1'), {from: depositor1}), 'insufficient collateral balance');

        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, amount18('0'), {from: depositor1}), 'non-zero amount expected');
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, amount18('501'), {from: depositor1}), 'insufficient collateral balance');
        await this.fmint.mustWithdraw(this.tkn18.address, amount18('500.123456789123456789'), {from: depositor1});
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, wei1, {from: depositor1}), 'insufficient collateral balance');

        expect(await this.tkn0.balanceOf(depositor1)).to.be.bignumber.equal(amount0('100'));
        expect(await this.tkn18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('500.123456789123456789'));
        expect(await this.tkn18.balanceOf(depositor2)).to.be.bignumber.equal(amount18('200.0'));

        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.totalOf(depositor2)).to.be.bignumber.equal(amount0('0'));
        expect(await this.debtPool.total()).to.be.bignumber.equal(amount0('0'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount0('0'));
        expect(await this.collateralPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.collateralPool.total()).to.be.bignumber.equal(amount0('0'));
    });

    it('checking single mint', async () => {
        await this.priceOracle.setPrice(this.tkn0.address, ratio8('1500000000000000000.0'));
        await this.tkn0.mint(depositor1, amount0('1'));
        await this.tkn0.approve(this.fmint.address, amount0('1'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn0.address, amount0('1'), {from: depositor1});

        expect(await this.fmint.collateralCanDecrease(depositor1, this.tkn0.address, amount0('1'))).to.equal(true);
        expect(await this.fmint.collateralCanDecrease(depositor1, this.tknStable18.address, amount0('1'))).to.equal(false);
        expect(await this.fmint.debtCanIncrease(depositor1, this.tkn0.address, amount0('1'))).to.equal(false);
        expect(await this.fmint.debtCanIncrease(depositor1, this.tkn18.address, amount0('1'))).to.equal(true);
        expect(await this.fmint.debtCanIncrease(depositor1, this.tknStable18.address, amount0('1'))).to.equal(true);

        await expectRevert(this.fmint.mustMint(this.tknStable18.address, amount18('0'), {from: depositor1}), 'non-zero amount expected');
        await expectRevert(this.fmint.mustMint(this.tkn0.address, amount0('1'), {from: depositor1}), 'minting of the token prohibited');
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, wei1, {from: depositor1}), 'token has no value');
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('0.12345678'));
        let max = amount18('4.050000332100027232');
        expect(await findMaxMintable(this.fmint, depositor1, this.tknStable18.address, max, new BN('2'))).to.be.bignumber.equal(max);
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, max.add(wei1), {from: depositor1}), 'insufficient collateral value');
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, wei1, {from: depositor1}), 'amount too low');
        await this.fmint.mustMint(this.tknStable18.address, wei2, {from: depositor1});
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('1'), {from: depositor1}), 'insufficient collateral value remains');
        max = amount18('4.050000332100027230');
        expect(await findMaxMintable(this.fmint, depositor1, this.tknStable18.address, max, new BN('2'))).to.be.bignumber.equal(max);
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, max.add(wei1), {from: depositor1}), 'insufficient collateral value');
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, wei1, {from: depositor1}), 'amount too low');
        await this.fmint.mustMint(this.tknStable18.address, max, {from: depositor1});
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, wei1, {from: depositor1}), 'insufficient collateral value');
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('1'), {from: depositor1}), 'insufficient collateral value remains');

        expect(await this.fmint.collateralCanDecrease(depositor1, this.tkn0.address, amount0('1'))).to.equal(false);
        expect(await this.fmint.collateralCanDecrease(depositor1, this.tknStable18.address, wei1)).to.equal(false);
        expect(await this.fmint.debtCanIncrease(depositor1, this.tkn0.address, amount0('1'))).to.equal(false);
        expect(await this.fmint.debtCanIncrease(depositor1, this.tknStable18.address, amount0('1'))).to.equal(false);

        expect(await this.tknStable18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('4.029750330439527093').add(wei1)); // fee subtracted
        expect(await this.debtPool.balanceOf(depositor1, this.tknStable18.address)).to.be.bignumber.equal(amount18('4.050000332100027230').add(wei2));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('0.5'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('1.5'));
    });

    it('checking multiple mints', async () => {
        await this.priceOracle.setPrice(this.tkn0.address, ratio8('1000000000000000000.12345678'));
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('1.12345678'));
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('1.12345678'));

        await this.tkn0.mint(depositor1, amount0('1000'));
        await this.tkn0.approve(this.fmint.address, amount0('1000'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn0.address, amount0('1000'), {from: depositor1});
        await this.tkn18.mint(depositor1, amount18('10000'));
        await this.tkn18.approve(this.fmint.address, amount18('10000'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn18.address, amount18('10000'), {from: depositor1});
        await this.tkn0.mint(depositor2, amount0('100000'));
        await this.tkn0.approve(this.fmint.address, amount0('100000'), {from: depositor2});
        await this.fmint.mustDeposit(this.tkn0.address, amount0('100000'), {from: depositor2});

        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('1000.000000000000000123').add(amount18('11234.5678')));
        expect(await this.collateralPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('100000.000000000000012345'));

        await expectRevert(this.fmint.mustMint(this.tknStable18.address, amount18('0'), {from: depositor1}), 'non-zero amount expected');
        await expectRevert(this.fmint.mustMint(this.tkn0.address, amount0('1'), {from: depositor1}), 'minting of the token prohibited');
        let max = amount18('3630.036632710220206875');
        expect(await findMaxMintable(this.fmint, depositor1, this.tknStable18.address, max, new BN('2'))).to.be.bignumber.equal(max);
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, max.add(wei1), {from: depositor1}), 'insufficient collateral value');
        await this.fmint.mustMint(this.tknStable18.address, max, {from: depositor1});
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, wei1, {from: depositor1}), 'insufficient collateral value');

        await expectRevert(this.fmint.mustMint(this.tknStable18.address, amount18('0'), {from: depositor2}), 'non-zero amount expected');
        await expectRevert(this.fmint.mustMint(this.tkn0.address, amount0('1'), {from: depositor2}), 'minting of the token prohibited');
        max = amount18('29670.329937688687354263');
        expect(await findMaxMintable(this.fmint, depositor2, this.tknStable18.address, max, new BN('2'))).to.be.bignumber.equal(max);
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, max.add(wei1), {from: depositor2}), 'insufficient collateral value');
        await this.fmint.mustMint(this.tknStable18.address, max.sub(amount18('10000.0')), {from: depositor2});
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, amount18('10000.0').add(wei1), {from: depositor2}), 'insufficient collateral value');

        expect(await this.tknStable18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('3611.886449546669105840')); // fee subtracted
        expect(await this.tknStable18.balanceOf(depositor2)).to.be.bignumber.equal(amount18('19571.978288000243917491')); // fee subtracted
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('1000.000000000000000123').add(amount18('11234.5678')));
        expect(await this.collateralPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('100000.000000000000012345'));
        // note: total collateral isn't equal to a sum of collaterals of each individual depositor due to the price rounding
        expect(await this.collateralPool.total()).to.be.bignumber.equal(amount18('1000.000000000000000123').add(amount18('11234.5678')).add(amount18('100000.000000000000012345')).add(amount0('1')));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('4078.189266666666666707'));
        expect(await this.debtPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('22098.765533333333337448'));
        // note: total debt isn't equal to a sum of debt of each individual depositor due to the price rounding
        expect(await this.debtPool.total()).to.be.bignumber.equal(amount18('4078.189266666666666707').add(amount18('22098.765533333333337448')).sub(amount0('1')));

        // withdraw
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('1'), {from: depositor1}), 'insufficient collateral value remains');
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, amount18('0.000000000000000010'), {from: depositor1}), 'insufficient collateral value remains');
        expect(await findMaxWithdrawable(this.fmint, depositor2, this.tkn0.address, amount0('33703'), new BN('2'))).to.be.bignumber.equal(amount0('33703'));
        await this.fmint.mustWithdraw(this.tkn0.address, amount0('1'), {from: depositor2})
        expect(await findMaxWithdrawable(this.fmint, depositor2, this.tkn0.address, amount0('33702'), new BN('2'))).to.be.bignumber.equal(amount0('33702'));
        expect(await this.tkn0.balanceOf(depositor2)).to.be.bignumber.equal(amount0('1'));
        await this.fmint.mustWithdraw(this.tkn0.address, amount0('999'), {from: depositor2})
        expect(await this.tkn0.balanceOf(depositor2)).to.be.bignumber.equal(amount0('1000'));
        expect(await findMaxWithdrawable(this.fmint, depositor2, this.tkn0.address, amount0('32703'), new BN('2'))).to.be.bignumber.equal(amount0('32703'));

        // change price
        await this.priceOracle.setPrice(this.tkn0.address, ratio8('2000000000000000000.0'));
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('3.0'));
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('7.0'));
        // burn the minted tokens
        await this.tknStable18.burn(depositor1, amount18('3611.886449546669105840'));
        await this.tknStable18.burn(depositor2, amount18('19571.978288000243917491'));

        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('2000').add(amount18('30000.0')));
        expect(await this.collateralPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('198000'));
        expect(await this.collateralPool.total()).to.be.bignumber.equal(amount18('2000').add(amount18('30000.0')).add(amount18('198000')));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('25410.256428971541448126'));
        expect(await this.debtPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('137692.309563820811479842'));
        // note: total debt isn't equal to a sum of debt of each individual depositor due to the price rounding
        expect(await this.debtPool.total()).to.be.bignumber.equal(amount18('25410.256428971541448126').add(amount18('137692.309563820811479842')).sub(amount0('1')));

        // undercollateralized
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, wei1, {from: depositor1}), 'insufficient collateral value');
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, wei1, {from: depositor2}), 'insufficient collateral value');
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('1'), {from: depositor1}), 'insufficient collateral value remains');
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, wei1, {from: depositor1}), 'insufficient collateral value remains');
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('1'), {from: depositor2}), 'insufficient collateral value remains');

        // change price
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('0.01'));

        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('2000').add(amount18('30000.0')));
        expect(await this.collateralPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('198000'));
        expect(await this.collateralPool.total()).to.be.bignumber.equal(amount18('2000').add(amount18('30000.0')).add(amount18('198000')));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('36.300366327102202069'));
        expect(await this.debtPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('196.703299376886873543'));
        expect(await this.debtPool.total()).to.be.bignumber.equal(amount18('36.300366327102202069').add(amount18('196.703299376886873543')));

        // mint more, due to the price changes
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, amount18('0'), {from: depositor1}), 'non-zero amount expected');
        await expectRevert(this.fmint.mustMint(this.tkn0.address, amount0('1'), {from: depositor1}), 'minting of the token prohibited');
        max = amount18('1063036.630033956446459724');
        expect(await findMaxMintable(this.fmint, depositor1, this.tknStable18.address, max, new BN('2'))).to.be.bignumber.equal(max);
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, max.add(wei1), {from: depositor1}), 'insufficient collateral value');
        await this.fmint.mustMint(this.tknStable18.address, max, {from: depositor1});
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, wei1, {from: depositor1}), 'insufficient collateral value');

        await expectRevert(this.fmint.mustMint(this.tknStable18.address, amount18('0'), {from: depositor2}), 'non-zero amount expected');
        await expectRevert(this.fmint.mustMint(this.tkn0.address, amount0('1'), {from: depositor2}), 'minting of the token prohibited');
        max = amount18('6580329.670062311312645736');
        expect(await findMaxMintable(this.fmint, depositor2, this.tknStable18.address, max, new BN('2'))).to.be.bignumber.equal(max);
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, max.add(wei1), {from: depositor2}), 'insufficient collateral value');
        await this.fmint.mustMint(this.tknStable18.address, max, {from: depositor2});
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, wei1, {from: depositor2}), 'insufficient collateral value');

        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('2000').add(amount18('30000.0')));
        expect(await this.collateralPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('198000'));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('10666.666666666666666666'));
        expect(await this.debtPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('66000.0'));

        // change price
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('0.011'));
        // undercollateralized
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, wei1, {from: depositor1}), 'insufficient collateral value');
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, wei1, {from: depositor2}), 'insufficient collateral value');
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('1'), {from: depositor1}), 'insufficient collateral value remains');
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, wei1, {from: depositor1}), 'insufficient collateral value remains');
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('1'), {from: depositor2}), 'insufficient collateral value remains');

        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('2000').add(amount18('30000.0')));
        expect(await this.collateralPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('198000'));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('11733.333333333333333333'));
        expect(await this.debtPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('72600.0'));

        // deposit more
        await this.tkn18.mint(depositor1, amount18('1500'));
        await this.tkn18.approve(this.fmint.address, amount18('1500'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn18.address, amount18('1500'), {from: depositor1});

        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('2000').add(amount18('34500.0')));
        expect(await this.collateralPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('198000'));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('11733.333333333333333333'));
        expect(await this.debtPool.totalOf(depositor2)).to.be.bignumber.equal(amount18('72600.0'));

        // depositor2 is undercollateralized
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, wei1, {from: depositor2}), 'insufficient collateral value');
        await expectRevert(this.fmint.mustWithdraw(this.tkn0.address, amount0('1'), {from: depositor2}), 'insufficient collateral value remains');
        // depositor1 isn't undercollateralized
        max = amount0('650');
        expect(await findMaxWithdrawable(this.fmint, depositor1, this.tkn0.address, max, new BN('2'))).to.be.bignumber.equal(max);
        max = amount18('39393.939393939393939400');
        expect(await findMaxMintable(this.fmint, depositor1, this.tknStable18.address, max, new BN('2'))).to.be.bignumber.equal(max);
        await this.fmint.mustMint(this.tknStable18.address, wei2, {from: depositor1});
        await this.fmint.mustWithdraw(this.tkn0.address, amount0('1'), {from: depositor1});
        await this.fmint.mustWithdraw(this.tkn18.address, wei1, {from: depositor1});
    });

    it('checking single repay', async () => {
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('1.0'));
        await this.tkn18.mint(depositor1, amount18('1.0'));
        await this.tkn18.approve(this.fmint.address, amount18('1.0'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn18.address, amount18('1.0'), {from: depositor1});

        await expectRevert(this.fmint.mustRepay(this.tknStable18.address, wei1, {from: depositor1}), 'insufficient debt outstanding');

        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('1.0'));
        await this.fmint.mustMint(this.tknStable18.address, amount18('0.33333333'), {from: depositor1});
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('2.0'));
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('3.0'));
        expect(await this.tknStable18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('0.331666663349999999'));

        // undercollateralized
        expect(await this.fmint.collateralCanDecrease(depositor1, this.tkn18.address, wei1)).to.equal(false);
        expect(await this.fmint.debtCanIncrease(depositor1, this.tknStable18.address, wei1)).to.equal(false);

        await expectRevert(this.fmint.mustRepay(this.tknStable18.address, amount18('0'), {from: depositor1}), 'non-zero amount expected');
        await expectRevert(this.fmint.mustRepay(this.tknStable18.address, amount18('0.33333333'), {from: depositor1}), 'insufficient allowance');
        await this.tknStable18.approve(this.fmint.address, amount18('0.33333332'), {from: depositor1});
        await expectRevert(this.fmint.mustRepay(this.tknStable18.address, amount18('0.33333333'), {from: depositor1}), 'insufficient allowance');
        await this.tknStable18.approve(this.fmint.address, amount18('0.33333333'), {from: depositor1});
        await expectRevert(this.fmint.mustRepay(this.tknStable18.address, amount18('0.33333333'), {from: depositor1}), 'ERC20: burn amount exceeds balance');
        await this.tknStable18.mint(depositor1, amount18('0.33333333').sub(amount18('0.331666663349999999'))); // additional tokens to cover the fee
        await this.fmint.mustRepay(this.tknStable18.address, amount18('0.33333333'), {from: depositor1});
        await expectRevert(this.fmint.mustRepay(this.tknStable18.address, wei1, {from: depositor1}), 'insufficient debt outstanding');

        expect(await this.fmint.collateralCanDecrease(depositor1, this.tkn18.address, wei1)).to.equal(true);
        expect(await this.fmint.debtCanIncrease(depositor1, this.tknStable18.address, wei1)).to.equal(true);

        expect(await this.tknStable18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.debtPool.tokensCount()).to.be.bignumber.equal(new BN('1'));
        expect(await this.debtPool.balanceOf(depositor1, this.tknStable18.address)).to.be.bignumber.equal(amount18('0'));
        expect(await this.debtPool.balanceOf(depositor1, this.tkn18.address)).to.be.bignumber.equal(amount18('0'));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.debtPool.total()).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.collateralPool.balanceOf(depositor1, this.tkn18.address)).to.be.bignumber.equal(amount18('1.0'));
        expect(await this.collateralPool.balanceOf(depositor1, this.tknStable18.address)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('2.0'));
        expect(await this.collateralPool.total()).to.be.bignumber.equal(amount18('2.0'));
    });

    it('checking reward of a single depositor for a single epoch', async () => {
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('5.12345678'));
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('5.12345678').muln(3).addn(1));

        await this.tkn18.mint(depositor1, amount18('1.0'));
        await this.tkn18.approve(this.fmint.address, amount18('1.0'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn18.address, amount18('1.0'), {from: depositor1});

        await this.fmint.mustMint(this.tknStable18.address, amount18('1.0'), {from: depositor1});

        await this.rewarder.setTime(await time.latest());
        await this.rewarder.mustRewardPush(); // initialize
        await expectRevert(this.rewarder.mustRewardPush(), "too early for a rewards push");
        await this.rewarder.increaseTime((new BN('3600')).subn(1));
        await expectRevert(this.rewarder.mustRewardPush(), "too early for a rewards push");
        await this.rewarder.increaseTime(new BN('1'));
        await expectRevert(this.rewarder.mustRewardPush(), "no rewards unlocked");

        await expectRevert(this.rewarder.rewardUpdateRate(1000000, {from: depositor1}), "caller is not the owner");
        await expectRevert(this.rewarder.rewardUpdateRate(0), "invalid reward rate");
        await this.rewarder.rewardUpdateRate(amount18('1.0').div(new BN('172800')));

        await expectRevert(this.rewarder.mustRewardPush(), "rewards depleted");
        await this.tknReward18.mint(this.rewarder.address, amount18('1.0'));
        await this.rewarder.mustRewardPush();
        expect(await this.tknReward18.balanceOf(this.rewarder.address)).to.be.bignumber.equal(amount18('1.0'));
        expect(await this.tknReward18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('0.0'));

        // no rewards, because collateral ratio is below 5.0
        await this.rewarder.increaseTime(new BN('1'));
        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.000000241126543209'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(ratio18('0.000000047063253104'));
        expect(await this.rewarder.rewardEarned(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.fmint.rewardIsEligible(depositor1)).to.equal(false);
        expect(await this.fmint.rewardCanClaim(depositor1)).to.equal(true);
        await expectRevert(this.rewarder.mustRewardClaim({from: depositor1}), "no rewards earned");
        await this.fmint.rewardUpdate(depositor1, {from: depositor2});
        expect(await this.rewarder.rewardStash(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.tknReward18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('0.0'));

        // no rewards, because collateral ratio is below 5.0
        await this.rewarder.increaseTime(new BN('10'));
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('5.12345678').muln(5).subn(1));
        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.000000241126543209'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(ratio18('0.000000517695784152'));
        expect(await this.rewarder.rewardEarned(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.fmint.rewardIsEligible(depositor1)).to.equal(false);
        expect(await this.fmint.rewardCanClaim(depositor1)).to.equal(true);
        await expectRevert(this.rewarder.mustRewardClaim({from: depositor1}), "no rewards earned");
        await this.fmint.rewardUpdate(depositor1, {from: depositor2});
        expect(await this.rewarder.rewardStash(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.tknReward18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('0.0'));

        // rewards, because collateral ratio is above 5.0
        await this.rewarder.increaseTime(new BN('100'));
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('5.12345678').muln(5).addn(1));
        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.000000241126543209'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('0.000005224021094638'));
        expect(await this.rewarder.rewardEarned(depositor1)).to.be.bignumber.equal(amount18('0.000024112654320895'));
        expect(await this.fmint.rewardIsEligible(depositor1)).to.equal(true);
        expect(await this.fmint.rewardCanClaim(depositor1)).to.equal(true);
        await this.rewarder.mustRewardClaim({from: depositor1});
        expect(await this.rewarder.rewardStash(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.tknReward18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('0.000024112654320895'));
        expect(await this.tknReward18.balanceOf(this.rewarder.address)).to.be.bignumber.equal(amount18('1.0').sub(amount18('0.000024112654320895')));

        // more rewards
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('1.12345678'));
        await this.rewarder.increaseTime(new BN('100'));
        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.000000241126543209'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('0.000026686933375874'));
        expect(await this.rewarder.rewardEarned(depositor1)).to.be.bignumber.equal(amount18('0.000024112654320899'));
        expect(await this.fmint.rewardIsEligible(depositor1)).to.equal(true);
        expect(await this.fmint.rewardCanClaim(depositor1)).to.equal(true);
        await this.fmint.rewardUpdate(depositor1, {from: depositor2});
        expect(await this.rewarder.rewardStash(depositor1)).to.be.bignumber.equal(amount18('0.000024112654320899'));

        // cannot claim when undercollateralized
        await this.rewarder.increaseTime(new BN('100'));
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('1.12345678').muln(3).subn(1));
        expect(await this.fmint.rewardIsEligible(depositor1)).to.equal(false);
        expect(await this.fmint.rewardCanClaim(depositor1)).to.equal(false);
        await expectRevert(this.rewarder.mustRewardClaim({from: depositor1}), "reward claim rejected");
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('1.12345678').muln(3).addn(1));
        expect(await this.fmint.rewardIsEligible(depositor1)).to.equal(false);
        expect(await this.fmint.rewardCanClaim(depositor1)).to.equal(true);
        await this.rewarder.mustRewardClaim({from: depositor1});
        expect(await this.rewarder.rewardStash(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.tknReward18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('0.000048225308641794'));
    });

    it('checking reward of 3 depositors for a single epoch', async () => {
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('5.0'));
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('5.0').muln(5).addn(1));

        await this.tkn18.mint(depositor1, amount18('1.0'));
        await this.tkn18.approve(this.fmint.address, amount18('1.0'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn18.address, amount18('1.0'), {from: depositor1});
        await this.fmint.mustMint(this.tknStable18.address, amount18('1.0'), {from: depositor1});

        await this.rewarder.setTime(await time.latest());
        await this.rewarder.rewardUpdateRate(amount18('0.001'));
        await this.rewarder.increaseTime(new BN('86400'));
        await this.tknReward18.mint(this.rewarder.address, amount18('86.4'));
        await this.rewarder.mustRewardPush();

        // rewards, because collateral ratio is above 5.0
        await this.rewarder.increaseTime(new BN('1000'));
        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.001'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('0.199999999999999999'));
        expect(await this.rewarder.rewardEarned(depositor1)).to.be.bignumber.equal(amount18('0.999999999999999995'));
        await this.rewarder.mustRewardClaim({from: depositor1});
        expect(await this.tknReward18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('0.999999999999999995'));

        // create second and third depositor
        await this.tkn18.mint(depositor2, amount18('2.0'));
        await this.tkn18.approve(this.fmint.address, amount18('2.0'), {from: depositor2});
        await this.fmint.mustDeposit(this.tkn18.address, amount18('2.0'), {from: depositor2});
        await this.fmint.mustMint(this.tknStable18.address, amount18('2.0'), {from: depositor2});

        await this.tkn18.mint(depositor3, amount18('6.0'));
        await this.tkn18.approve(this.fmint.address, amount18('6.0'), {from: depositor3});
        await this.fmint.mustDeposit(this.tkn18.address, amount18('6.0'), {from: depositor3});
        await this.fmint.mustMint(this.tknStable18.address, amount18('3.0'), {from: depositor3});

        // more rewards
        await this.rewarder.increaseTime(new BN('1000'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('0.233333333333333332')); // increased by 2/6
        expect(await this.rewarder.rewardEarned(depositor1)).to.be.bignumber.equal(amount18('0.166666666666666665'));
        expect(await this.rewarder.rewardEarned(depositor2)).to.be.bignumber.equal(amount18('0.333333333333333330'));
        expect(await this.rewarder.rewardEarned(depositor3)).to.be.bignumber.equal(amount18('0.499999999999999995'));
        expect(await this.fmint.rewardIsEligible(depositor1)).to.equal(true);
        expect(await this.fmint.rewardIsEligible(depositor2)).to.equal(true);
        expect(await this.fmint.rewardIsEligible(depositor3)).to.equal(true);
        await this.rewarder.mustRewardClaim({from: depositor1});
        await this.rewarder.mustRewardClaim({from: depositor2});
        await this.rewarder.mustRewardClaim({from: depositor3});
        expect(await this.rewarder.rewardStash(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardStash(depositor2)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardStash(depositor3)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.tknReward18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('1.166666666666666660'));
        expect(await this.tknReward18.balanceOf(depositor2)).to.be.bignumber.equal(amount18('0.333333333333333330'));
        expect(await this.tknReward18.balanceOf(depositor3)).to.be.bignumber.equal(amount18('0.499999999999999995'));

        // change price, so that first depositors 1 and 2 become undercollateralized
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('5.0').muln(3).addn(1));
        expect(await this.fmint.rewardCanClaim(depositor1)).to.equal(true);
        expect(await this.fmint.rewardCanClaim(depositor2)).to.equal(true);
        expect(await this.fmint.rewardCanClaim(depositor3)).to.equal(true);
        expect(await this.fmint.rewardIsEligible(depositor1)).to.equal(false);
        expect(await this.fmint.rewardIsEligible(depositor2)).to.equal(false);
        expect(await this.fmint.rewardIsEligible(depositor3)).to.equal(true);

        // more rewards
        await this.rewarder.increaseTime(new BN('1000'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('0.266666666666666665')); // increased by 2/6
        expect(await this.rewarder.rewardEarned(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardEarned(depositor2)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardEarned(depositor3)).to.be.bignumber.equal(amount18('0.499999999999999995'));
        await expectRevert(this.rewarder.mustRewardClaim({from: depositor1}), "no rewards earned");
        await expectRevert(this.rewarder.mustRewardClaim({from: depositor2}), "no rewards earned");
        await this.rewarder.mustRewardClaim({from: depositor3});
        expect(await this.rewarder.rewardStash(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardStash(depositor2)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardStash(depositor3)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.tknReward18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('1.166666666666666660'));
        expect(await this.tknReward18.balanceOf(depositor2)).to.be.bignumber.equal(amount18('0.333333333333333330'));
        expect(await this.tknReward18.balanceOf(depositor3)).to.be.bignumber.equal(amount18('0.999999999999999990'));

        // depositor2 increases his deposit
        await this.rewarder.increaseTime(new BN('200'));
        await this.tkn18.mint(depositor2, amount18('2.0'));
        await this.tkn18.approve(this.fmint.address, amount18('2.0'), {from: depositor2});
        await this.fmint.mustDeposit(this.tkn18.address, amount18('2.0'), {from: depositor2});
        expect(await this.fmint.rewardCanClaim(depositor1)).to.equal(true);
        expect(await this.fmint.rewardCanClaim(depositor2)).to.equal(true);
        expect(await this.fmint.rewardCanClaim(depositor3)).to.equal(true);
        expect(await this.fmint.rewardIsEligible(depositor1)).to.equal(false);
        expect(await this.fmint.rewardIsEligible(depositor2)).to.equal(true);
        expect(await this.fmint.rewardIsEligible(depositor3)).to.equal(true);
        expect(await this.rewarder.rewardStash(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardStash(depositor2)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardStash(depositor3)).to.be.bignumber.equal(amount18('0.0'));

        // depositor2 withdraws a part of his deposit
        await this.rewarder.increaseTime(new BN('100'));
        await this.fmint.mustWithdraw(this.tkn18.address, amount18('2.0'), {from: depositor2});
        expect(await this.fmint.rewardCanClaim(depositor1)).to.equal(true);
        expect(await this.fmint.rewardCanClaim(depositor2)).to.equal(true);
        expect(await this.fmint.rewardCanClaim(depositor3)).to.equal(true);
        expect(await this.fmint.rewardIsEligible(depositor1)).to.equal(false);
        expect(await this.fmint.rewardIsEligible(depositor2)).to.equal(false);
        expect(await this.fmint.rewardIsEligible(depositor3)).to.equal(true);
        expect(await this.rewarder.rewardStash(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardStash(depositor2)).to.be.bignumber.equal(amount18('0.033333333333333330'));
        expect(await this.rewarder.rewardStash(depositor3)).to.be.bignumber.equal(amount18('0.0'));

        // more rewards
        await this.rewarder.increaseTime(new BN('700'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('0.299999999999999997')); // increased by 2/6
        expect(await this.rewarder.rewardEarned(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardEarned(depositor2)).to.be.bignumber.equal(amount18('0.033333333333333330'));
        expect(await this.rewarder.rewardEarned(depositor3)).to.be.bignumber.equal(amount18('0.499999999999999980'));
        await expectRevert(this.rewarder.mustRewardClaim({from: depositor1}), "no rewards earned");
        await this.rewarder.mustRewardClaim({from: depositor2});
        await this.rewarder.mustRewardClaim({from: depositor3});
        expect(await this.rewarder.rewardStash(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardStash(depositor2)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardStash(depositor3)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.tknReward18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('1.166666666666666660'));
        expect(await this.tknReward18.balanceOf(depositor2)).to.be.bignumber.equal(amount18('0.366666666666666660'));
        expect(await this.tknReward18.balanceOf(depositor3)).to.be.bignumber.equal(amount18('1.499999999999999970'));

        // epoch ends, reward is payed only for 82400 seconds
        await this.rewarder.increaseTime(new BN('1000000'));
        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.001'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('3.046666666666666663'));
        expect(await this.rewarder.rewardEarned(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardEarned(depositor2)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardEarned(depositor3)).to.be.bignumber.equal(amount18('41.199999999999999992'));
        await expectRevert(this.rewarder.mustRewardClaim({from: depositor1}), "no rewards earned");
        await expectRevert(this.rewarder.mustRewardClaim({from: depositor2}), "no rewards earned");
        await this.rewarder.mustRewardClaim({from: depositor3});
        expect(await this.rewarder.rewardStash(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardStash(depositor2)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardStash(depositor3)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.tknReward18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('1.166666666666666660'));
        expect(await this.tknReward18.balanceOf(depositor2)).to.be.bignumber.equal(amount18('0.366666666666666660'));
        expect(await this.tknReward18.balanceOf(depositor3)).to.be.bignumber.equal(amount18('42.699999999999999962'));

        // start new epoch
        await this.tknReward18.mint(this.rewarder.address, amount18('1000.0'));
        await this.rewarder.mustRewardPush();
        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.01162037037037037'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('3.046666666666666663'));
        expect(await this.rewarder.rewardEpochEnds()).to.be.bignumber.equal((await this.rewarder.time()).add(new BN('86400')));
    });

    it('checking changing reward epochs', async () => {
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('5.0'));
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('5.0').muln(5).addn(1));

        await this.tkn18.mint(depositor1, amount18('1.0'));
        await this.tkn18.approve(this.fmint.address, amount18('1.0'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn18.address, amount18('1.0'), {from: depositor1});
        await this.fmint.mustMint(this.tknStable18.address, amount18('1.0'), {from: depositor1});

        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardEpochEnds()).to.be.bignumber.equal(new BN('0'));

        await this.rewarder.setTime(await time.latest());
        await this.rewarder.rewardUpdateRate(amount18('0.001'));
        await this.rewarder.increaseTime(new BN('10000'));
        await this.tknReward18.mint(this.rewarder.address, amount18('10.0'));
        await this.rewarder.mustRewardPush();

        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.000115740740740740'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.rewarder.rewardEpochEnds()).to.be.bignumber.equal((await this.rewarder.time()).add(new BN('86400')));
        await this.rewarder.increaseTime(new BN('1'));
        await this.rewarder.rewardUpdateGlobal();
        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.000115740740740740'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('0.000023148148148147'));
        expect(await this.rewarder.rewardEpochEnds()).to.be.bignumber.equal((await this.rewarder.time()).add(new BN('86399')));

        await this.rewarder.increaseTime((new BN('3600')).subn(2));
        await expectRevert(this.rewarder.mustRewardPush(), "too early for a rewards push");
        await this.rewarder.increaseTime(new BN('1'));
        await this.rewarder.mustRewardPush();

        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.000152584876543209'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('0.083333333333332798'));
        expect(await this.rewarder.rewardEpochEnds()).to.be.bignumber.equal((await this.rewarder.time()).add(new BN('86400')));

        for (let i = 0; i < 50; i++) {
            await this.rewarder.increaseTime(new BN('3600'));
            await this.rewarder.mustRewardPush();
        }

        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.000899091923981197')); // rate gets close to 0.001
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('23.183691553604502668'));
        expect(await this.rewarder.rewardEpochEnds()).to.be.bignumber.equal((await this.rewarder.time()).add(new BN('86400')));

        // change reward rate leads to prev. rewards being pushed
        await this.rewarder.increaseTime(new BN('1000'));
        await this.rewarder.rewardUpdateRate(amount18('0.5'));

        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.000900259841527710'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('23.363509938400742067'));
        expect(await this.rewarder.rewardEpochEnds()).to.be.bignumber.equal((await this.rewarder.time()).add(new BN('86400')));

        await this.rewarder.increaseTime((new BN('3600')).subn(1));
        await expectRevert(this.rewarder.mustRewardPush(), "too early for a rewards push");
        await this.rewarder.increaseTime(new BN('1'));
        await expectRevert(this.rewarder.mustRewardPush(), "rewards depleted");
        await this.tknReward18.mint(this.rewarder.address, amount18('10000000.0'));
        await this.rewarder.mustRewardPush();

        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.021696082348130722'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('24.011697024300693266'));
        expect(await this.rewarder.rewardEpochEnds()).to.be.bignumber.equal((await this.rewarder.time()).add(new BN('86400')));

        for (let i = 0; i < 5; i++) {
            await this.rewarder.increaseTime(new BN('42000'));
            await this.rewarder.mustRewardPush();
        }

        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.482858450535540540')); // rate gets close to 0.5
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('13055.125974745858983058'));
        expect(await this.rewarder.rewardEpochEnds()).to.be.bignumber.equal((await this.rewarder.time()).add(new BN('86400')));

        for (let i = 0; i < 5; i++) {
            await this.rewarder.increaseTime(new BN('3600'));
            await this.rewarder.mustRewardPush();
        }

        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.486144153999394243')); // rate gets close to 0.5
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('14798.349018890466945908'));
        expect(await this.rewarder.rewardEpochEnds()).to.be.bignumber.equal((await this.rewarder.time()).add(new BN('86400')));
    });

    it('checking random rewards', async () => {
        const depositors = [depositor1, depositor2, depositor3];

        let self = this;

        let seed = new BN('807627835588225756107397120016124');
        function r(n) {
            seed = randBig(seed);
            return seed.mod(n)
        }

        function randDepositor() {
            return depositors[r(new BN(depositors.length)).toNumber()];
        }

        async function randDeposit() {
            const depositor = randDepositor();
            const amount = r(amount18('1.0'))

            await self.tkn18.mint(depositor, amount);
            await self.tkn18.approve(self.fmint.address, amount, {from: depositor});
            await self.fmint.mustDeposit(self.tkn18.address, amount, {from: depositor});
        }

        async function randPassTime() {
            await self.rewarder.increaseTime(r(new BN('80000')));
        }

        async function randWithdraw() {
            const depositor = randDepositor();
            const amount = r(amount18('1.0'))

            await self.fmint.withdraw(self.tkn18.address, amount, {from: depositor}); // may fail
        }

        async function randMint() {
            const depositor = randDepositor();
            const amount = r(amount18('1.0'))

            await self.fmint.mint(self.tknStable18.address, amount, {from: depositor}); // may fail
        }

        async function randRepay() {
            const depositor = randDepositor();
            const amount = r(amount18('1.0'))

            await self.fmint.repay(self.tknStable18.address, amount, {from: depositor}); // may fail
        }

        async function _randChangePrice(token) {
            let price = await self.priceOracle.getPrice(token);
            price = price.add(r(ratio8('2.0'))).sub(ratio8('1.0'));
            if (price.ltn(0)) {
                price = wei1;
            }
            await self.priceOracle.setPrice(token, price);
        }

        async function randChangePrice() {
            // uncomment for an accurate calculation
            // for (let d = 0; d < depositors.length; d++) {
            //     await self.rewarder.rewardUpdate(depositors[d]);
            // }
            await _randChangePrice(self.tkn18.address);
            await _randChangePrice(self.tknStable18.address);
        }

        async function randChangeRate() {
            await self.rewarder.rewardUpdateRate(r(amount18('1.0')));
        }

        async function randPushRewards() {
            await self.rewarder.rewardPush(); // may fail
        }

        async function randAction() {
            const choice = r(new BN(11)).toNumber();
            if (choice < 3) {
                await randPassTime();
            } else if (choice < 5) {
                await randChangePrice();
            } else if (choice < 6) {
                await randDeposit();
            } else if (choice < 7) {
                await randWithdraw();
            } else if (choice < 8) {
                await randMint();
            } else if (choice < 9) {
                await randRepay();
            } else if (choice < 10) {
                await randPushRewards();
            } else {
                await randChangeRate();
            }
        }

        await this.rewarder.setTime(await time.latest());
        await this.tknReward18.mint(this.rewarder.address, amount18('100000000000000.0'));
        await this.rewarder.rewardUpdateRate(wei1);
        await this.rewarder.increaseTime(new BN('3600'));
        await this.rewarder.mustRewardPush();
        await self.priceOracle.setPrice(self.tknStable18.address, ratio8('10.0'));
        await self.priceOracle.setPrice(self.tkn18.address, ratio8('50.0'));

        const startTime = await this.rewarder.time();

        // let prevTime = new BN('0');
        // let rewardsEstimated = [new BN('0'), new BN('0'), new BN('0')];

        for (let i = 0; i < 500; i++) {
            // estimate rewards for each depositor with a naive O(N) algorithm, and compare results with the contract O(1) algorithm
            // const rewardTime = await this.rewarder.rewardApplicableUntil();
            // const elapsed = rewardTime.sub(prevTime);
            // prevTime = await this.rewarder.time();
            // const totalWeight = await this.rewarder.principalBalance();
            // const rate = await this.rewarder.rewardRate();
            // if (!totalWeight.isZero() && elapsed.gtn(0) && !rate.isZero()) {
            //     console.log('totalWeight', web3.utils.fromWei(totalWeight, "ether"));
            //     console.log('rate', web3.utils.fromWei(rate, "ether"));
            //     console.log('elapsed', elapsed.toString());
            //     for (let d = 0; d < depositors.length; d++) {
            //         const weight = await this.rewarder.principalBalanceOf(depositors[d]);
            //         const rewardIsEligible = await this.fmint.rewardIsEligible(depositors[d])
            //         console.log('weight', web3.utils.fromWei(weight, "ether"));
            //         console.log('rewardIsEligible', rewardIsEligible);
            //         if (rewardIsEligible) {
            //             rewardsEstimated[d] = rewardsEstimated[d].add(elapsed.mul(rate).mul(weight).div(totalWeight));
            //         }
            //     }
            //     console.log('---------');
            // }

            await randAction();
        }

        const endTime = await this.rewarder.time();

        // console.log('start', startTime.toString())
        // console.log('end', endTime.toString())
        // console.log('rewardRate', web3.utils.fromWei(await this.rewarder.rewardRate(), "ether"))
        // console.log('rewardPerToken', web3.utils.fromWei(await this.rewarder.rewardPerToken(), "ether"))
        // console.log('rewardEpochEnds', (await this.rewarder.rewardEpochEnds()).toString())
        // console.log('rewardStash1', web3.utils.fromWei(await this.rewarder.rewardStash(depositor1), "ether"))
        // console.log('rewardStash2', web3.utils.fromWei(await this.rewarder.rewardStash(depositor2), "ether"))
        // console.log('rewardStash3', web3.utils.fromWei(await this.rewarder.rewardStash(depositor3), "ether"))
        // console.log('rewardEarned1', web3.utils.fromWei(await this.rewarder.rewardEarned(depositor1), "ether"))
        // console.log('rewardEarned2', web3.utils.fromWei(await this.rewarder.rewardEarned(depositor2), "ether"))
        // console.log('rewardEarned3', web3.utils.fromWei(await this.rewarder.rewardEarned(depositor3), "ether"))
        // console.log('rewardEstimated1', web3.utils.fromWei(rewardsEstimated[0], "ether"))
        // console.log('rewardEstimated2', web3.utils.fromWei(rewardsEstimated[1], "ether"))
        // console.log('rewardEstimated3', web3.utils.fromWei(rewardsEstimated[2], "ether"))

        expect(endTime).to.be.bignumber.equal(startTime.add(new BN('5802541')));

        expect(await this.rewarder.rewardRate()).to.be.bignumber.equal(amount18('0.030021302824196496'));
        expect(await this.rewarder.rewardPerToken()).to.be.bignumber.equal(amount18('61269.152870292674110787'));
        expect(await this.rewarder.rewardEpochEnds()).to.be.bignumber.equal(endTime.sub(new BN('265224')));

        expect(await this.rewarder.rewardStash(depositor1)).to.be.bignumber.equal(amount18('820499.297781655253894349'));
        expect(await this.rewarder.rewardStash(depositor2)).to.be.bignumber.equal(amount18('301788.464504373415725462'));
        expect(await this.rewarder.rewardStash(depositor3)).to.be.bignumber.equal(amount18('109391.941347548249878784'));
        await this.rewarder.mustRewardClaim({from: depositor1});
        await this.rewarder.mustRewardClaim({from: depositor2});
        await this.rewarder.mustRewardClaim({from: depositor3});
        expect(await this.tknReward18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('820499.297781655253894349'));
        expect(await this.tknReward18.balanceOf(depositor2)).to.be.bignumber.equal(amount18('325558.670805236487469485'));
        expect(await this.tknReward18.balanceOf(depositor3)).to.be.bignumber.equal(amount18('109391.941347548249878784'));
    });

    it('checking dust operations', async () => {
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('10.0'));
        // cannot mint without deposit
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('10000000000.0'));
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, wei1, {from: depositor1}), 'insufficient collateral value');
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, wei2, {from: depositor1}), 'insufficient collateral value');
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('0.00000001'));
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, wei1, {from: depositor1}), 'insufficient collateral value');
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, wei2, {from: depositor1}), 'insufficient collateral value');

        // cannot fully withdraw with a dust debt
        await this.tkn18.mint(depositor1, amount18('1.0'));
        await this.tkn18.approve(this.fmint.address, amount18('1.0'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn18.address, amount18('1.0'), {from: depositor1});

        await this.fmint.mustMint(this.tknStable18.address, wei2, {from: depositor1});
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('10000000000.0'));
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, amount18('1.0'), {from: depositor1}), 'insufficient collateral value');
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('0.00000001'));
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, amount18('1.0'), {from: depositor1}), 'insufficient collateral value');

        // repay 1 wei, still have 1 wei of debt
        await this.tknStable18.approve(this.fmint.address, wei1, {from: depositor1});
        await this.fmint.mustRepay(this.tknStable18.address, wei1, {from: depositor1});
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('10000000000.0'));
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, amount18('1.0'), {from: depositor1}), 'insufficient collateral value');
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('0.00000001'));
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, amount18('1.0'), {from: depositor1}), 'insufficient collateral value');

        // mint a lot of debt, and then repay almost all of it, attempt to fully withdraw
        await this.fmint.mustMint(this.tknStable18.address, amount18('1000.0'), {from: depositor1});
        await this.tknStable18.mint(depositor1, amount18('5.000000000000000001')); // cover the minting fee
        await this.tknStable18.approve(this.fmint.address, amount18('1000.0'), {from: depositor1});
        await this.fmint.mustRepay(this.tknStable18.address, amount18('1000.0'), {from: depositor1});

        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('10000000000.0'));
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, amount18('1.0'), {from: depositor1}), 'insufficient collateral value');
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('0.00000001'));
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, amount18('1.0'), {from: depositor1}), 'insufficient collateral value');

        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(amount18('10'));
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(wei1);

        // withdraw as much as possible
        expect(await this.fmint.minToDeposit(depositor1, this.tkn18.address, ratio4('10000000000000000000.0'))).to.be.bignumber.equal(amount18('0'));
        expect(await this.fmint.minToDeposit(depositor1, this.tkn18.address, ratio4('10000000000000000001.0'))).to.be.bignumber.equal(wei1);
        expect(await this.fmint.minToDeposit(depositor1, this.tkn18.address, ratio4('100000000000000000000.0'))).to.be.bignumber.equal(amount18('9.000000000000000001'));
        max = amount18('333333333.333333333299999998');
        expect(await this.fmint.maxToMint(depositor1, this.tknStable18.address, ratio4('3.0'))).to.be.bignumber.equal(amount18('333333333.333333333100000000'));
        expect(await findMaxMintable(this.fmint, depositor1, this.tknStable18.address, max, new BN('2'))).to.be.bignumber.equal(max);
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, max.add(wei1), {from: depositor1}), 'insufficient collateral value');
        max = amount18('0.999999999999999999');
        expect(await this.fmint.maxToWithdraw(depositor1, this.tkn18.address, ratio4('3.0'))).to.be.bignumber.equal(max);
        expect(await findMaxWithdrawable(this.fmint, depositor1, this.tkn18.address, max, new BN('2'))).to.be.bignumber.equal(max);
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, max.add(wei1), {from: depositor1}), 'insufficient collateral value');
        // lower price
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('1.0'));
        max = amount18('33333333.333333333299999998');
        expect(await this.fmint.maxToMint(depositor1, this.tknStable18.address, ratio4('3.0'))).to.be.bignumber.equal(amount18('33333333.333333333100000000'));
        expect(await findMaxMintable(this.fmint, depositor1, this.tknStable18.address, max, new BN('2'))).to.be.bignumber.equal(max);
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, max.add(wei1), {from: depositor1}), 'insufficient collateral value');
        max = amount18('0.999999999999999997');
        expect(await this.fmint.maxToWithdraw(depositor1, this.tkn18.address, ratio4('3.0'))).to.be.bignumber.equal(max);
        expect(await findMaxWithdrawable(this.fmint, depositor1, this.tkn18.address, max, new BN('2'))).to.be.bignumber.equal(max);
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, max.add(wei1), {from: depositor1}), 'insufficient collateral value');
        // lower price
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('0.1'));
        max = amount18('3333333.333333333299999998');
        expect(await this.fmint.maxToMint(depositor1, this.tknStable18.address, ratio4('3.0'))).to.be.bignumber.equal(amount18('3333333.333333333100000000'));
        expect(await findMaxMintable(this.fmint, depositor1, this.tknStable18.address, max, new BN('2'))).to.be.bignumber.equal(max);
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, max.add(wei1), {from: depositor1}), 'insufficient collateral value');
        max = amount18('0.999999999999999970');
        expect(await this.fmint.maxToWithdraw(depositor1, this.tkn18.address, ratio4('3.0'))).to.be.bignumber.equal(max);
        expect(await findMaxWithdrawable(this.fmint, depositor1, this.tkn18.address, max, new BN('2'))).to.be.bignumber.equal(max);
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, max.add(wei1), {from: depositor1}), 'insufficient collateral value');
        // lower price
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('0.00000001'));
        max = amount18('0.333333333299999998');
        expect(await this.fmint.maxToMint(depositor1, this.tknStable18.address, ratio4('3.0'))).to.be.bignumber.equal(amount18('0.333333333100000000'));
        expect(await findMaxMintable(this.fmint, depositor1, this.tknStable18.address, max, new BN('2'))).to.be.bignumber.equal(max);
        await expectRevert(this.fmint.mustMint(this.tknStable18.address, max.add(wei1), {from: depositor1}), 'insufficient collateral value');
        max = amount18('0.999999999700000000');
        expect(await this.fmint.maxToWithdraw(depositor1, this.tkn18.address, ratio4('3.0'))).to.be.bignumber.equal(max);
        expect(await findMaxWithdrawable(this.fmint, depositor1, this.tkn18.address, max, new BN('2'))).to.be.bignumber.equal(max);
        await expectRevert(this.fmint.mustWithdraw(this.tkn18.address, max.add(wei1), {from: depositor1}), 'insufficient collateral value');

        await this.fmint.mustWithdraw(this.tkn18.address, max, {from: depositor1});

        expect(await this.collateralPool.totalOf(depositor1)).to.be.bignumber.equal(wei3);
        expect(await this.debtPool.totalOf(depositor1)).to.be.bignumber.equal(wei1);
        expect(await this.fmint.minToDeposit(depositor1, this.tkn18.address, ratio4('3.0'))).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.fmint.minToDeposit(depositor1, this.tkn18.address, ratio4('3.5'))).to.be.bignumber.equal(amount18('0.000000000200000001'));
        expect(await this.fmint.minToDeposit(depositor1, this.tkn18.address, ratio4('4.0').sub(wei1))).to.be.bignumber.equal(amount18('0.000000000200000001'));
        expect(await this.fmint.minToDeposit(depositor1, this.tkn18.address, ratio4('4.0'))).to.be.bignumber.equal(amount18('0.000000000200000001'));
        expect(await this.fmint.minToDeposit(depositor1, this.tkn18.address, ratio4('4.5'))).to.be.bignumber.equal(amount18('0.000000000300000001'));
        expect(await this.fmint.minToDeposit(depositor1, this.tkn18.address, ratio4('5.0').sub(wei1))).to.be.bignumber.equal(amount18('0.000000000300000001'));
        expect(await this.fmint.minToDeposit(depositor1, this.tkn18.address, ratio4('5.0'))).to.be.bignumber.equal(amount18('0.000000000300000001'));
    });

    it('checking edge functions', async () => {
        await this.priceOracle.setPrice(this.tkn18.address, ratio8('3.0'));
        await this.priceOracle.setPrice(this.tknStable18.address, ratio8('1.5'));
        await this.tkn18.mint(depositor1, amount18('1.0'));
        await this.tkn18.approve(this.fmint.address, amount18('1.0'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn18.address, amount18('1.0'), {from: depositor1});

        // check mustMintMax
        expect(await this.fmint.minToDeposit(depositor1, this.tkn18.address, ratio4('3.0'))).to.be.bignumber.equal(amount18('0'));
        expect(await this.fmint.maxToWithdraw(depositor1, this.tkn18.address, ratio4('3.0'))).to.be.bignumber.equal(amount18('1.0'));
        expect(await this.fmint.maxToMint(depositor1, this.tknStable18.address, ratio4('3.0'))).to.be.bignumber.equal(amount18('0.666666666666666666'));

        await expectRevert(this.fmint.mustRepayMax(this.tknStable18.address, {from: depositor1}), 'non-zero amount expected');

        await expectRevert(this.fmint.mustMintMax(this.tknStable18.address, ratio4('2.99'), {from: depositor1}), 'insufficient collateral value');
        await expectRevert(this.fmint.mustMintMax(this.tkn18.address, ratio4('3.0'), {from: depositor1}), 'minting of the token prohibited');
        await this.fmint.mustMintMax(this.tknStable18.address, ratio4('3.0'), {from: depositor1});
        expect(await this.tknStable18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('0.663333333333333332'));
        expect(await this.debtPool.balanceOf(depositor1, this.tknStable18.address)).to.be.bignumber.equal(amount18('0.666666666666666666'));

        expect(await this.fmint.minToDeposit(depositor1, this.tkn18.address, ratio4('3.0'))).to.be.bignumber.equal(amount18('0'));
        expect(await this.fmint.minToDeposit(depositor1, this.tkn18.address, ratio4('5.0'))).to.be.bignumber.equal(amount18('0.666666666666666668'));
        expect(await this.fmint.maxToWithdraw(depositor1, this.tkn18.address, ratio4('3.0'))).to.be.bignumber.equal(amount18('0'));
        expect(await this.fmint.maxToWithdraw(depositor1, this.tkn18.address, ratio4('2.0'))).to.be.bignumber.equal(amount18('0.333333333333333333'));
        expect(await this.fmint.maxToMint(depositor1, this.tknStable18.address, ratio4('3.0'))).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.fmint.maxToMint(depositor1, this.tknStable18.address, ratio4('2.0'))).to.be.bignumber.equal(amount18('0.333333333333333332'));

        await expectRevert(this.fmint.mustRepayMax(this.tknStable18.address, {from: depositor1}), 'insufficient allowance');
        await this.tknStable18.approve(this.fmint.address, amount18('0.663333333333333332').sub(wei1), {from: depositor1});
        await expectRevert(this.fmint.mustRepayMax(this.tknStable18.address, {from: depositor1}), 'insufficient allowance');
        await this.tknStable18.approve(this.fmint.address, amount18('0.663333333333333332'), {from: depositor1});
        await this.fmint.mustRepayMax(this.tknStable18.address, {from: depositor1});
        expect(await this.tknStable18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.debtPool.balanceOf(depositor1, this.tknStable18.address)).to.be.bignumber.equal(amount18('0.666666666666666666').sub(amount18('0.663333333333333332')));
        await expectRevert(this.fmint.mustRepayMax(this.tknStable18.address, {from: depositor1}), 'non-zero amount expected');

        // check minToDeposit
        expect(await this.fmint.minToDeposit(depositor1, this.tkn18.address, ratio4('3.0'))).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.fmint.minToDeposit(depositor1, this.tkn18.address, ratio4('1000.0'))).to.be.bignumber.equal(amount18('0.666666666666667334'));
        expect(await this.fmint.maxToWithdraw(depositor1, this.tkn18.address, ratio4('3.0'))).to.be.bignumber.equal(amount18('0.994999999999999998'));
        expect(await this.fmint.maxToMint(depositor1, this.tknStable18.address, ratio4('3.0'))).to.be.bignumber.equal(amount18('0.663333333333333331'));

        await this.tkn18.mint(depositor1, amount18('0.666666666666667334'));
        await this.tkn18.approve(this.fmint.address, amount18('0.666666666666667334'), {from: depositor1});
        await this.fmint.mustDeposit(this.tkn18.address, amount18('0.666666666666667334'), {from: depositor1});

        expect(await this.fmint.minToDeposit(depositor1, this.tkn18.address, ratio4('1000.0'))).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.fmint.maxToWithdraw(depositor1, this.tkn18.address, ratio4('3.0'))).to.be.bignumber.equal(amount18('1.661666666666667332'));
        expect(await this.fmint.maxToWithdraw(depositor1, this.tkn18.address, ratio4('1000.0'))).to.be.bignumber.equal(amount18('0.0'));
        expect(await this.fmint.maxToMint(depositor1, this.tknStable18.address, ratio4('1000.0'))).to.be.bignumber.equal(amount18('0.0'));

        // check mustWithdrawMax
        await expectRevert(this.fmint.mustWithdrawMax(this.tkn18.address, ratio4('2.99'), {from: depositor1}), 'insufficient collateral value');
        await expectRevert(this.fmint.mustWithdrawMax(this.tkn18.address, ratio4('3.0'), {from: depositor2}), 'non-zero amount expected');
        await this.fmint.mustWithdrawMax(this.tkn18.address, ratio4('3.0'), {from: depositor1});
        expect(await this.tkn18.balanceOf(depositor1)).to.be.bignumber.equal(amount18('1.661666666666667332'));
        expect(await this.collateralPool.balanceOf(depositor1, this.tkn18.address)).to.be.bignumber.equal(amount18('1.0').add(amount18('0.666666666666667334')).sub(amount18('1.661666666666667332')));
    });
});
