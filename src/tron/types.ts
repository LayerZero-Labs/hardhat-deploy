import {ContractExecutionParams} from 'tronweb/interfaces';

export interface CreateSmartContract extends ContractExecutionParams {
  data?: string;
  method?: TronTxMethods;
}

export enum TronTxMethods {
  CREATE = 'create',
}
