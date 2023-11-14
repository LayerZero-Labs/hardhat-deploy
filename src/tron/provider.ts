import {
  ExternalProvider,
  JsonRpcFetchFunc,
  JsonRpcSigner,
  Networkish,
  Web3Provider,
} from '@ethersproject/providers';
import {HttpNetworkConfig} from 'hardhat/types';
import {TronSigner} from './signer';
import {BigNumber, Wallet} from 'ethers';
import {Time} from './utils';
import {HDNode} from 'ethers/lib/utils';

export class TronWeb3Provider extends Web3Provider {
  protected signer = new Map<string, TronSigner>();
  public gasPrice: {time: number; value?: BigNumber} = {time: Time.NOW};
  private readonly fullHost: string;
  private readonly headers: Record<string, string>;

  constructor(
    provider: ExternalProvider | JsonRpcFetchFunc,
    config: HttpNetworkConfig,
    network?: Networkish | undefined
  ) {
    super(provider, network);
    const {httpHeaders, url, accounts} = config;
    let fullHost = url;
    // the address of the tron node has the jsonrpc path chopped off
    fullHost = fullHost.replace(/\/jsonrpc\/?$/, '');
    this.fullHost = fullHost;
    this.headers = httpHeaders;
    // instantiate Tron Signer
    if (Array.isArray(accounts)) {
      for (const pk of accounts) {
        const addr = new Wallet(pk).address;
        this.signer.set(addr, new TronSigner(fullHost, httpHeaders, pk, this));
      }
    } else if (typeof accounts !== 'string' && 'mnemonic' in accounts) {
      const hdNode = HDNode.fromMnemonic(
        accounts.mnemonic,
        accounts.passphrase
      );
      const derivedNode = hdNode.derivePath(
        `${accounts.path}/${accounts.initialIndex}`
      );
      this.signer.set(
        derivedNode.address,
        new TronSigner(fullHost, httpHeaders, derivedNode.privateKey, this)
      );
    } else {
      throw new Error(
        'unable to instantiate Tron Signer, unrecognized private key'
      );
    }
  }

  addSigner(pk: string): TronSigner {
    const addr = new Wallet(pk).address;
    if (this.signer.has(addr)) return this.signer.get(addr)!;
    const signer = new TronSigner(this.fullHost, this.headers, pk, this);
    this.signer.set(addr, signer);
    return signer;
  }

  override async getTransactionCount(): Promise<number> {
    console.log(
      'getTransactionCount is not available in in the Tron protocol, returning dummy value 1 ...'
    );
    return 1;
  }

  override getSigner(address: string): JsonRpcSigner {
    const signer = this.signer.get(address);
    if (!signer) throw new Error('No Tron signer exists for this address');
    return signer as any;
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
