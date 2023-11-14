// Linguo
// gasLimit in EVM == energyConsumption in TVM
// gasPrice in EVM == energyPrice in TVM
import {ExternallyOwnedAccount} from '@ethersproject/abstract-signer';

import {BigNumber, BytesLike, Wallet} from 'ethers';
import {SigningKey, hexlify} from 'ethers/lib/utils';
import TronWeb from 'tronweb';
import {TronWeb3Provider} from './provider';
import {Time} from './time';
import {BuildTransaction, CreateSmartContract} from './types';
import {TronWebError} from './utils';
import {TronWebError1} from 'tronweb/interfaces';

export class TronSigner extends Wallet {
  public tronweb: TronWeb;
  public tronProvider?: TronWeb3Provider;
  public gasPrice: {time: number; value?: BigNumber} = {time: Time.NOW};
  public energyFactors = new Map<string, {time: number; value: number}>();

  constructor(
    fullHost: string,
    headers: Record<string, string>,
    privateKey: BytesLike | ExternallyOwnedAccount | SigningKey,
    provider?: TronWeb3Provider
  ) {
    super(privateKey, provider);
    this.tronProvider = provider;
    //TODO convert byteslike to string
    if (typeof privateKey !== 'string') {
      throw new Error(
        'TronSigner currently only supports mnemonic or hex encoded private key'
      );
    }
    this.tronweb = new TronWeb({
      fullHost,
      headers,
      privateKey: privateKey.slice(2),
    });
  }

  override async sendTransaction(
    transaction: CreateSmartContract
  ): Promise<any> {
    switch (transaction.method) {
      case BuildTransaction.CREATE:
        return this.handleCreate(transaction);
      default:
        return super.sendTransaction(transaction);
    }
  }

  async handleCreate(transaction: CreateSmartContract) {
    delete transaction.method;
    delete transaction.data;

    const unsignedTx =
      await this.tronweb.transactionBuilder.createSmartContract(
        transaction,
        this.tronweb.address.toHex(this.address)
      );

    const signedTx = await this.tronweb.trx.sign(unsignedTx);

    const response = await this.tronweb.trx.sendRawTransaction(signedTx);
    if (!('result' in response) || !response.result) {
      throw new TronWebError(response as TronWebError1); // in this case tronweb returs an error-like object with a message and a code
    }
    // must wait a bit here for the jsonrpc node to be aware of the tx
    console.log(
      'Contract deployed, waiting to retrieve transaction response...'
    );
    await Time.sleep(5 * Time.SECOND);
    const txRes = await this.provider.getTransaction('0x' + response.txid);
    txRes.wait = async function (this: TronSigner) {
      return this.provider.getTransactionReceipt('0x' + response.txid);
    }.bind(this);
    return txRes;
  }

  async getFeeLimit(unsignedTx: any, overrides: any): Promise<string> {
    // https://developers.tron.network/docs/set-feelimit#how-to-determine-the-feelimit-parameter
    // https://developers.tron.network/reference/getcontractinfo, get energy_factor
    // https://developers.tron.network/docs/resource-model#dynamic-energy-model, max factor
    // Tight FeeLimit of contract transaction = estimated basic energy consumption * (1 + energy_factor) * EnergyPrice
    // Loose FeeLimit of contract transaction = estimated basic energy consumption * (1 + max_energy_factor) * EnergyPrice
    const contract_address = unsignedTx.to ?? '';
    const data = '0x' + unsignedTx.data;
    const MAX_FEE_LIMIT = this.tronweb.feeLimit;
    const energy_factor = await this.getEnergyFactor(contract_address);
    const gasLimit =
      overrides?.gasLimit ?? (await this.getGasLimit(contract_address, data));
    const enegyPrice = Number(await this.getGasPrice());
    const factor = 1 + energy_factor;
    const feeLimit = Number(gasLimit) * factor * enegyPrice;
    const adjusted = Math.floor(Math.min(feeLimit, MAX_FEE_LIMIT));
    return hexlify(adjusted);
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

  async getGasLimit(contract_address: string, data: string): Promise<string> {
    const gasLimit = await this.estimateGas({
      to: contract_address, // need to slice off the "41" prefix that Tron appends to addresses
      data,
    });
    return gasLimit.toString();
  }

  //cache the energy_factor with a 10min TTL, energy factors should be updated by Tron every 6h
  async getEnergyFactor(contract_address: string): Promise<number> {
    const cached = this.energyFactors.get(contract_address);
    if (cached && cached.time > Time.NOW - 10 * Time.MINUTE) {
      return cached.value;
    }
    const MAX_ENERGY_FACTOR = 1.2;
    const res = await this.tronweb.fullNode.request(
      'wallet/getcontractinfo',
      {value: contract_address, visible: false},
      'post'
    );
    const energy_factor =
      res?.contract_state?.energy_factor ?? MAX_ENERGY_FACTOR;
    this.energyFactors.set(contract_address, {
      time: Time.NOW,
      value: energy_factor,
    });
    return energy_factor;
  }
}