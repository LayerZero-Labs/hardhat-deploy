import {assert, expect} from 'chai';

import {useEnvironment} from './helpers';
import {getDefaultArtifact} from '../src/defaultArtifacts';

import {ProxyAdmin as regularProxyAdmin} from '../extendedArtifacts';
import {ProxyAdmin as tronProxyAdmin} from '../extendedArtifactsTron';

describe('hardhat-deploy hre extension', function () {
  useEnvironment('hardhat-project', 'hardhat');
  it('It should add the deployments field', function () {
    assert.isNotNull(this.env.deployments);
  });

  it('The getChainId should give the correct chainId', async function () {
    assert.equal(await this.env.getChainId(), '31337');
  });
});

describe(`${getDefaultArtifact.name} function tests`, function () {
  it('should return a regular default artifact if the tron param is false', function () {
    const artifact = getDefaultArtifact('DefaultProxyAdmin', false);
    expect(artifact).to.equal(regularProxyAdmin);
  });
  it('should return a tron default artifact if the tron param is true', function () {
    const artifact = getDefaultArtifact('DefaultProxyAdmin', true);
    expect(artifact).to.equal(tronProxyAdmin);
  });
});

describe('@layerzerolabs/hardhat-deploy with a non-tron network', function () {
  useEnvironment('hardhat-project', 'hardhat');
  it('should not set the tron boolean in the network', function () {
    expect(this.env.network.tron).to.be.undefined;
  });
});

describe('@layerzerolabs/hardhat-deploy with a tron network', function () {
  useEnvironment('hardhat-project', 'tron');
  it('It should set the tron boolean in the network', function () {
    expect(this.env.network.tron).to.be.true;
  });
});
