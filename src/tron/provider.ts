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
import {
  Time,
  TronTransactionFailedError,
  TronWebError,
  ensure0x,
} from './utils';
import {Deferrable, HDNode, parseTransaction} from 'ethers/lib/utils';
import TronWeb from 'tronweb';
import {TronWebError1} from 'tronweb/interfaces';

/**
 * A provider for interacting with the TRON blockchain, extending the Web3Provider.
 *
 * `TronWeb3Provider` is designed to integrate TRON's blockchain functionalities with the Web3 interface.
 * It extends the `Web3Provider` class, adapting it to work with the TRON network.
 * This class manages a collection of `TronSigner` instances for transaction signing
 * and provides methods for interacting with the TRON blockchain, such as sending transactions,
 * estimating gas, and retrieving transaction details.
 *
 * Key Features:
 * - Signer Management: Maintains a collection of `TronSigner` instances for different addresses.
 * - Transaction Handling: Provides methods for sending transactions, estimating gas, and more.
 * - TronWeb Integration: Utilizes TronWeb for direct interactions with the TRON network.
 * - Configurable: Can be configured with custom network settings and HTTP headers.
 *
 * @extends Web3Provider
 *
 * @constructor
 * @param {ExternalProvider | JsonRpcFetchFunc} provider - The underlying JSON-RPC provider.
 * @param {HttpNetworkConfig} config - Configuration for the network, including HTTP headers and URL.
 * @param {Networkish | undefined} [network] - The network configuration.
 */
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

  /**
   * Adds a new signer to the signer collection.
   *
   * This method creates and adds a new `TronSigner` instance to the signer collection using the provided private key.
   * If a signer already exists for the derived address, it returns the existing signer.
   * Otherwise, it creates a new `TronSigner`, adds it to the collection, and returns it.
   *
   * @param {string} pk - The private key to create a new signer.
   * @returns {TronSigner} The newly added or existing `TronSigner` instance.
   */
  addSigner(pk: string): TronSigner {
    const addr = new Wallet(pk).address;
    if (this.signer.has(addr)) return this.signer.get(addr)!;
    const signer = new TronSigner(this.fullHost, this.headers, pk, this);
    this.signer.set(addr, signer);
    return signer;
  }

  /**
   * Retrieves the transaction count for an account.
   *
   * This method overrides the `getTransactionCount` method. Since the Tron protocol does not support
   * the concept of nonces as in Ethereum, this method returns a dummy value.
   *
   * @returns {Promise<number>} A promise that resolves to the dummy transaction count.
   */
  override async getTransactionCount(): Promise<number> {
    console.log(
      'getTransactionCount is not available in the Tron protocol, returning dummy value 1 ...'
    );
    return 1;
  }

  /**
   * Retrieves a signer instance for a given address.
   *
   * This method overrides the `getSigner` method to return a signer instance
   * associated with the provided address. If no signer is found for the given address, it throws an error.
   *
   * @template T - The type of signer to be returned, either `TronSigner` or `JsonRpcSigner`.
   * @param {string} address - The address to retrieve the signer for.
   * @returns {T} The signer instance corresponding to the given address.
   * @throws {Error} Throws an error if no signer exists for the provided address.
   */
  override getSigner<T extends TronSigner | JsonRpcSigner = JsonRpcSigner>(
    address: string
  ): T {
    const signer = this.signer.get(address);
    if (!signer) {
      throw new Error(`No Tron signer exists for this address ${address}`);
    }
    return signer as T;
  }

  /**
   * Retrieves the current gas price with caching.
   *
   * This method overrides the `getGasPrice` method to include a caching mechanism with a 15-second TTL.
   * If the cached value is recent (within 15 seconds), it returns the cached value. Otherwise, it fetches
   * the current gas price from the network. If fetching fails, it defaults to a predefined energy price.
   *
   * @returns {Promise<BigNumber>} A promise that resolves to the current gas price as a BigNumber.
   */
  override async getGasPrice(): Promise<BigNumber> {
    const DEFAULT_ENERGY_PRICE = BigNumber.from('1000');
    const {time, value} = this.gasPrice;
    if (time > Time.NOW - 15 * Time.SECOND && value) return value;
    const gasPrice = (await super.getGasPrice()) ?? DEFAULT_ENERGY_PRICE;
    this.gasPrice = {time: Time.NOW, value: gasPrice};
    return gasPrice;
  }

  /**
   * Sends a signed transaction to the network.
   *
   * This method first checks if the signed transaction is a simple TRX transfer (send TRX transaction).
   * If so, it handles the transaction through the `sendTrx` method.
   *
   * @param {string | Promise<string>} signedTransaction - The signed transaction or a promise that resolves to it.
   * @returns {Promise<TransactionResponse>} A promise that resolves to the transaction response.
   */
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

  /**
   * Sends TRX from one account to another.
   *
   * This method handles the sending of TRX tokens by creating, signing, and sending a transaction.
   * It accounts for the difference in decimal places between TRX (6 decimals) and ETH (18 decimals).
   * If the value is extremely large (more than 1000 TRX), it scales down the value to prevent errors.
   * After sending the transaction, it waits briefly for the transaction to be processed.
   *
   * @param {string} from - The address to send TRX from.
   * @param {string} to - The address to send TRX to.
   * @param {BigNumber} value - The amount of TRX to send, as a BigNumber.
   * @returns {Promise<TransactionResponse>} A promise that resolves to the transaction response.
   * @throws {TronWebError} Throws an error if the transaction fails.
   */
  async sendTrx(
    from: string,
    to: string,
    value: BigNumber
  ): Promise<TransactionResponse> {
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

  /**
   * Creates a function that waits for a specified number of confirmations of a transaction.
   *
   * This method generates a function that, when called, will continuously check for the number of confirmations
   * of a given transaction until it reaches the specified target. It checks the transaction status every second.
   * If the transaction is found to have failed (status 0), a `TronTransactionFailedError` is thrown.
   *
   * @param {number} initialConfirmations - The initial number of confirmations at the time of this method call.
   * @param {string} hash - The hash of the transaction to wait for.
   * @returns {Function} A function that takes `targetConfirmations` and returns a promise that resolves to the transaction receipt.
   */
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
      const receipt = await this.getTransactionReceipt(ensure0x(hash));
      const {status} = receipt;
      if (status === 0) {
        throw new TronTransactionFailedError(receipt);
      }
      return receipt;
    };
  }

  /**
   * Estimates the gas required for a transaction on the TRON network.
   *
   * This method overrides the `estimateGas` method to accommodate TRON's specific requirements.
   * TRON does not support EIP-1559 transactions and nonces, so related fields are removed from the transaction object.
   * It then calls the superclass's `estimateGas` method for the actual estimation.
   *
   * @param {Deferrable<TransactionRequest>} transaction - The transaction object to estimate gas for.
   * @returns {Promise<BigNumber>} A promise that resolves to the estimated gas as a BigNumber.
   */
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
