import {
  ExternalProvider,
  JsonRpcFetchFunc,
  JsonRpcSigner,
  Networkish,
  TransactionReceipt,
  TransactionRequest,
  TransactionResponse,
  Web3Provider,
} from '@ethersproject/providers';
import {HttpNetworkConfig} from 'hardhat/types';
import {TronSigner} from './signer';
import {BigNumber, Wallet} from 'ethers';
import {Time, TronWebError, ensure0x} from './utils';
import {Deferrable, HDNode, parseTransaction} from 'ethers/lib/utils';
import TronWeb from 'tronweb';
import {TronWebError1} from 'tronweb/interfaces';

export class TronWeb3Provider extends Web3Provider {
  protected signer = new Map<string, TronSigner>();
  public ro_tronweb: TronWeb;
  public gasPrice: {time: number; value?: BigNumber} = {time: Time.NOW};
  private readonly fullHost: string;
  private readonly headers: Record<string, string>;

  constructor(
    provider: ExternalProvider | JsonRpcFetchFunc,
    config: HttpNetworkConfig,
    network?: Networkish | undefined
  ) {
    super(provider, network);
    const {httpHeaders: headers, url, accounts} = config;
    let fullHost = url;
    // the address of the tron node has the jsonrpc path chopped off
    fullHost = fullHost.replace(/\/jsonrpc\/?$/, '');
    this.fullHost = fullHost;
    this.headers = headers;
    this.ro_tronweb = new TronWeb({fullHost, headers});
    // instantiate Tron Signer
    if (Array.isArray(accounts)) {
      for (const pk of accounts) {
        const addr = new Wallet(pk).address;
        this.signer.set(addr, new TronSigner(fullHost, headers, pk, this));
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
        new TronSigner(fullHost, headers, derivedNode.privateKey, this)
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

  override getSigner<T extends TronSigner | JsonRpcSigner = JsonRpcSigner>(
    address: string
  ): T {
    const signer = this.signer.get(address);
    if (!signer) throw new Error('No Tron signer exists for this address');
    return signer as T;
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

  override async sendTransaction(
    signedTransaction: string | Promise<string>
  ): Promise<TransactionResponse> {
    signedTransaction = await signedTransaction;
    const deser = parseTransaction(signedTransaction);
    const {to, data, from, value} = deser;
    // is this a send eth transaction?
    if (to && from && (!data || data == '0x')) {
      return this.sendTrx(from, to, value);
    }
    // TODO, smart contract calls, etc

    // otherwise don't alter behavior
    return super.sendTransaction(signedTransaction);
  }

  async sendTrx(
    from: string,
    to: string,
    value: BigNumber
  ): Promise<TransactionResponse> {
    /*
     * TRX has 6 decimals, ETH has 18.
     * For safety's sake, I'm going to remove 12 zeros if the value is insanely big.
     * If someone tries to send more than 1000 TRX with hardhat-deploy, something is sus.
     */
    if (value.gt(10 ** 9)) value = value.div(10 ** 12);
    const unsignedTx = await this.ro_tronweb.transactionBuilder.sendTrx(
      this.ro_tronweb.address.toHex(to),
      Math.floor(value.toNumber()),
      this.ro_tronweb.address.toHex(from)
    );
    const signedTx = await this.getSigner<TronSigner>(from).sign(unsignedTx);
    const response = await this.ro_tronweb.trx.sendRawTransaction(signedTx);
    if (!('result' in response) || !response.result) {
      throw new TronWebError(response as TronWebError1);
    }
    await Time.sleep(5 * Time.SECOND);
    const txRes = await this.getTransaction(ensure0x(response.txid));
    txRes.wait = this._buildWait(txRes.confirmations, response.txid);
    return txRes;
  }

  _buildWait(initialConfirmations: number, hash: string) {
    return async (
      targetConfirmations?: number
    ): Promise<TransactionReceipt> => {
      let curr_conf = initialConfirmations;
      while (targetConfirmations && curr_conf < targetConfirmations) {
        await Time.sleep(Time.SECOND); // sleep 1 sec
        const {confirmations: latest_conf} = await this.getTransaction(
          ensure0x(hash)
        );
        curr_conf = latest_conf;
      }
      return this.getTransactionReceipt(ensure0x(hash));
    };
  }

  override async estimateGas(
    transaction: Deferrable<TransactionRequest>
  ): Promise<BigNumber> {
    // tron does not support eip1559 tx and doesn't support nonces either
    // https://developers.tron.network/reference/eth_estimategas
    const toDel = ['type', 'maxFeePerGas', 'maxPriorityFeePerGas', 'nonce'];
    for (const field of toDel) {
      delete (transaction as {[key: string]: any})[field];
    }
    return super.estimateGas(transaction);
  }
}
