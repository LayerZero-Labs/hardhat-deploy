import {TronSigner} from './signer';
import {Contract, ContractFactory, ContractInterface, ethers} from 'ethers';
import {Artifact} from 'hardhat/types';
import {ExtendedArtifact} from '../../types';
import {TransactionRequest} from '@ethersproject/providers';
import {CreateSmartContract, TronTxMethods} from './types';
export {Contract} from 'ethers';

export class TronContractFactory extends ContractFactory {
  public default_originEnergyLimit = 1e7;
  public abi: any;
  public readonly contractName: string;

  constructor(
    abi: ContractInterface,
    bytecode: ethers.BytesLike,
    signer: TronSigner,
    artifact: Artifact | ExtendedArtifact
  ) {
    super(abi, bytecode, signer);
    this.contractName = (artifact as any).contractName ?? '';
    this.abi = abi;
  }

  override async deploy(...args: Array<any>): Promise<Contract> {
    throw new Error('deploy is not implemented on Tron contract factory');
  }

  override getDeployTransaction(
    ...args: any[]
  ): ethers.providers.TransactionRequest {
    const {data, value} = super.getDeployTransaction(
      ...args
    ) as TransactionRequest;

    const params = this.interface.encodeDeploy(
      args.slice(0, this.interface.deploy.inputs.length)
    );

    const tx: CreateSmartContract = {
      feeLimit: undefined,
      callValue: value ? Number(value.toString()) : 0,
      userFeePercentage: 100,
      originEnergyLimit: this.default_originEnergyLimit,
      abi: this.abi,
      bytecode: this.bytecode.slice(2),
      rawParameter: params.slice(2),
      name: this.contractName,
      data: data?.toString().slice(2) ?? '',
      method: TronTxMethods.CREATE,
    };
    return tx;
  }
}
