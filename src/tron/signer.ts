/** Tron Lingo
 *  gasLimit in EVM == energyConsumption in TVM
 *  gasPrice in EVM == energyPrice in TVM
 */

import {BigNumber, Wallet} from 'ethers';
import {Deferrable, hexlify} from 'ethers/lib/utils';
import TronWeb from 'tronweb';
import {TronWeb3Provider} from './provider';
import {Time, TronWebGetTransactionError, ensure0x, strip0x} from './utils';
import {CreateSmartContract, TronTxMethods} from './types';
import {TronWebError} from './utils';
import {BlockTransaction, Transaction, TronWebError1} from 'tronweb/interfaces';
import {
  TransactionRequest,
  TransactionResponse,
} from '@ethersproject/providers';

export class TronSigner extends Wallet {
  protected tronweb: TronWeb;
  public gasPrice: {time: number; value?: BigNumber} = {time: Time.NOW};
  public energyFactors = new Map<string, {time: number; value: number}>();
  public MAX_ENERGY_FACTOR = 1.2;
  // we cannot directly use floats we bignumber from ethersjs so we'll have to work around by multiplying and divising
  public MAX_ENERGY_DIVISOR = 1000;

  constructor(
    fullHost: string,
    headers: Record<string, string>,
    privateKey: string,
    provider: TronWeb3Provider
  ) {
    super(privateKey, provider);
    this.tronweb = new TronWeb({
      fullHost,
      headers,
      privateKey: strip0x(privateKey),
    });
  }

  async sign(
    unsignedTx: Record<string, unknown> | Transaction,
    privateKey?: string
  ): Promise<Transaction> {
    return this.tronweb.trx.sign(unsignedTx, privateKey);
  }

  override async sendTransaction(
    transaction: CreateSmartContract | Deferrable<TransactionRequest>
  ): Promise<TransactionResponse> {
    if (!('method' in transaction)) return super.sendTransaction(transaction);
    switch (transaction.method) {
      case TronTxMethods.CREATE:
        return this.create(transaction as CreateSmartContract);
      default:
        throw new Error('sendTransaction method not implemented');
    }
  }

  async create(transaction: CreateSmartContract): Promise<TransactionResponse> {
    delete transaction.method;
    delete transaction.data;

    const unsignedTx =
      await this.tronweb.transactionBuilder.createSmartContract(
        transaction,
        this.tronweb.address.toHex(this.address)
      );

    const signedTx = await this.sign(unsignedTx);

    const response = await this.tronweb.trx.sendRawTransaction(signedTx);
    if (!('result' in response) || !response.result) {
      throw new TronWebError(response as TronWebError1); // in this case tronweb returs an error-like object with a message and a code
    }
    // must wait a bit here for the jsonrpc node to be aware of the tx
    console.log('\nTransaction broadcast, waiting for response...');
    await Time.sleep(5 * Time.SECOND);
    const txRes = await this.provider.getTransaction(ensure0x(response.txid));
    txRes.wait = (this.provider as TronWeb3Provider)._buildWait(
      txRes.confirmations,
      response.txid
    );
    return txRes;
  }

  async getFeeLimit(
    unsignedTx: Record<string, any>,
    overrides?: Record<string, any>
  ): Promise<string> {
    // https://developers.tron.network/docs/set-feelimit#how-to-determine-the-feelimit-parameter
    // https://developers.tron.network/reference/getcontractinfo, get energy_factor
    // https://developers.tron.network/docs/resource-model#dynamic-energy-model, max factor
    // Tight FeeLimit of contract transaction = estimated basic energy consumption * (1 + energy_factor) * EnergyPrice
    // Loose FeeLimit of contract transaction = estimated basic energy consumption * (1 + max_energy_factor) * EnergyPrice
    const contract_address = unsignedTx.to ?? '';
    const data = unsignedTx.data;
    const factor = 1 + (await this.getEnergyFactor(contract_address));
    const factor_adj = BigNumber.from(
      Math.floor(factor * this.MAX_ENERGY_DIVISOR)
    );
    let energy_consumption: BigNumber;
    if (overrides?.gasLimit) {
      energy_consumption = BigNumber.from(overrides?.gasLimit.toString());
    } else {
      energy_consumption = await this.getEnergyConsumption(
        contract_address,
        data
      );
    }
    const enegyPrice = await this.getEnergyPrice();
    const feeLimit = energy_consumption
      .mul(enegyPrice)
      .mul(factor_adj)
      .div(this.MAX_ENERGY_DIVISOR);
    return hexlify(feeLimit);
  }

  getEnergyPrice = (): Promise<BigNumber> => this.getGasPrice();
  override async getGasPrice(): Promise<BigNumber> {
    return this.provider.getGasPrice();
  }

  async getEnergyConsumption(
    contract_address: string,
    data: string
  ): Promise<BigNumber> {
    const gasLimit = await this.estimateGas({
      to: contract_address, // need to slice off the "41" prefix that Tron appends to addresses
      data,
    });
    return gasLimit;
  }

  //cache the energy_factor with a 10min TTL, energy factors should be updated by Tron every 6h
  async getEnergyFactor(contract_address: string): Promise<number> {
    const cached = this.energyFactors.get(contract_address);
    if (cached && cached.time > Time.NOW - 10 * Time.MINUTE) {
      return cached.value;
    }
    let energy_factor = this.MAX_ENERGY_FACTOR;
    // if the contract does not exist yet, aka it is create tx, return max
    if (contract_address == '') return energy_factor;
    const res = await this.tronweb.fullNode.request(
      'wallet/getcontractinfo',
      {value: contract_address, visible: false},
      'post'
    );

    // check it's a sensible value
    if (res?.contract_state?.energy_factor < this.MAX_ENERGY_FACTOR) {
      energy_factor = Number(res?.contract_state?.energy_factor);
    }
    this.energyFactors.set(contract_address, {
      time: Time.NOW,
      value: energy_factor,
    });
    return energy_factor;
  }

  async getTronWebTransaction(hash: string): Promise<BlockTransaction> {
    const res = await this.tronweb.trx.getTransaction(hash);
    // Tronweb sometimes throws error, sometimes doesn't :-/ so let's check
    if ('Error' in res) throw new TronWebGetTransactionError(res);
    return res;
  }
}
