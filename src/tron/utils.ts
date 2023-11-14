import {TronWebError1, TronWebError2} from 'tronweb/interfaces';

export const isArrayofBytes = (data: any): boolean => {
  return (
    Buffer.isBuffer(data) ||
    (Array.isArray(data) &&
      data.every((num) => typeof num === 'number' && num >= 0 && num <= 255))
  );
};

export class TronWebError extends Error {
  readonly code: string;
  readonly hash: string;
  constructor({code, message, txid}: TronWebError1) {
    // need to convert the message to utf-8
    message = Buffer.from(message, 'hex').toString();
    super(message);
    this.code = code;
    this.name = this.constructor.name;
    this.hash = txid;
  }
}

export class TronWebGetTransactionError extends Error {
  constructor({Error}: TronWebError2) {
    super(Error);
    this.name = this.constructor.name;
  }
}

// Base unit in milliseconds
const MILLISECOND = 1;
const SECOND = 1000 * MILLISECOND;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const Time = {
  MILLISECOND,
  SECOND,
  MINUTE,
  HOUR,
  DAY,
  get NOW() {
    return Date.now();
  },
  sleep(ms: number): Promise<void> {
    return new Promise<void>((res) => setTimeout(res, ms));
  },
} as const;
