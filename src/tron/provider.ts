import {
  ExternalProvider,
  JsonRpcFetchFunc,
  JsonRpcSigner,
  Networkish,
  Web3Provider,
} from '@ethersproject/providers';
import {HttpNetworkConfig} from 'hardhat/types';
import {TronSigner} from './signer';
import {BigNumber} from 'ethers';
import {Time} from './utils';

export class TronWeb3Provider extends Web3Provider {
  protected signer: TronSigner;
  public gasPrice: {time: number; value?: BigNumber} = {time: Time.NOW};

  constructor(
    provider: ExternalProvider | JsonRpcFetchFunc,
    config: HttpNetworkConfig,
    network?: Networkish | undefined
  ) {
    super(provider, network);
    let fullHost = config.url;
    // the address of the tron node has the jsonrpc path chopped off
    fullHost = fullHost.replace(/\/jsonrpc\/?$/, '');
    this.signer = new TronSigner(
      fullHost,
      config.httpHeaders,
      (config.accounts as any)[0],
      this
    );
  }
  override async getTransactionCount(): Promise<number> {
    console.log(
      'getTransactionCount is not available in in the Tron protocol, returning dummy value 1 ...'
    );
    return 1;
  }

  override getSigner(address: string): JsonRpcSigner {
    if (address && this.signer.address != address) {
      throw new Error('signer instance does not match the address');
    }
    return this.signer as any;
  }

  // cache the gasPrice with a 15sec TTL
  override async getGasPrice(): Promise<BigNumber> {
    const DEFAULT_ENERGY_PRICE = BigNumber.from('1000');
    const {time, value} = this.gasPrice;
    if (time > Time.NOW - 15 * Time.SECOND && value) return value;
    const gasPrice = (await super.getGasPrice()) ?? DEFAULT_ENERGY_PRICE;
    this.gasPrice = {time: Time.NOW, value: gasPrice};
    return gasPrice;
  }
}
