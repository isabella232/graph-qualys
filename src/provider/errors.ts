import { QualysApiRequestResponse } from './QualysClient';

const QUALYS_CLIENT_API_ERROR = Symbol('QualysClientApiError');

type QualysClientErrorOptions = {
  code: string;
  message: string;
};

export class QualysClientError extends Error {
  code: string;
  constructor(options: QualysClientErrorOptions) {
    super(options.message);
    this.code = options.code;
  }
}

export class QualysClientLoginError extends QualysClientError {
  constructor(options: QualysClientErrorOptions) {
    super(options);
  }
}

export class QualysClientApiError extends QualysClientError {
  public requestResponse: QualysApiRequestResponse<any>;

  constructor(
    options: QualysClientErrorOptions & {
      requestResponse: QualysApiRequestResponse<any>;
    },
  ) {
    const { code, message, requestResponse } = options;
    super({
      code: code,
      message: `${message} (code=${code}, url: ${requestResponse.request.url}, responseStatus=${requestResponse.response.status})`,
    });
    this.requestResponse = requestResponse;
  }
}

Object.defineProperty(
  QualysClientApiError.prototype,
  'QUALYS_CLIENT_API_ERROR',
  {
    value: QUALYS_CLIENT_API_ERROR,
    enumerable: false,
    writable: false,
  },
);

export function toPossibleQualysClientApiError(err: any) {
  return err.QUALYS_CLIENT_API_ERROR === QUALYS_CLIENT_API_ERROR
    ? (err as QualysClientApiError)
    : undefined;
}
