import EventEmitter from 'events';
import xmlParser from 'fast-xml-parser';
import chunk from 'lodash/chunk';
import fetch, { RequestInfo, RequestInit, Response } from 'node-fetch';
import querystring from 'querystring';
import { URLSearchParams } from 'url';

import {
  IntegrationProviderAPIError,
  IntegrationProviderAuthenticationError,
} from '@jupiterone/integration-sdk-core';

import { QualysIntegrationConfig } from '../../types';
import { executeAPIRequest } from './request';
import { assets, RateLimitConfig, RateLimitState, vmpc, was } from './types';
import { PortalInfo } from './types/portal';
import { toArray } from './util';
import { buildFilterXml } from './was/util';

export * from './types';

export type ResourceIteratee<T> = (each: T) => Promise<void> | void;

/**
 * An initial rate limit state for a standard subscription level.
 *
 * @see https://www.qualys.com/docs/qualys-api-limits.pdf for details on
 * subscription level rate limits.
 */
const STANDARD_RATE_LIMIT_STATE: RateLimitState = {
  limit: 300,
  limitRemaining: 300,
  limitWindowSeconds: 60 * 60,
  toWaitSeconds: 0,
  concurrency: 2,
  concurrencyRunning: 0,
};

const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  responseCode: 409,
  maxAttempts: 5,
  reserveLimit: 30,
  cooldownPeriod: 1000,
};

export type QualysAPIClientConfig = {
  config: QualysIntegrationConfig;

  /**
   * Initializes the API client with a `RateLimitConfig`.
   *
   * @see DEFAULT_RATE_LIMIT_CONFIG
   */
  rateLimitConfig?: Partial<RateLimitConfig>;

  /**
   * Initializes the API client with a `RateLimitState`. When not provided, the
   * `STANDARD_RATE_LIMIT_STATE` is used to be conservative. The state will
   * update based on the responses so that a customer with a bigger subscription
   * will get their benefits.
   *
   * @see STANDARD_RATE_LIMIT_STATE
   */
  rateLimitState?: RateLimitState;
};

export class QualysAPIClient {
  public events: EventEmitter;

  private config: QualysIntegrationConfig;
  private rateLimitConfig: RateLimitConfig;
  private rateLimitState: RateLimitState;

  constructor({
    config,
    rateLimitConfig,
    rateLimitState,
  }: QualysAPIClientConfig) {
    this.config = config;
    this.rateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG, ...rateLimitConfig };
    this.rateLimitState = rateLimitState || STANDARD_RATE_LIMIT_STATE;
    this.events = new EventEmitter();
  }

  public async verifyAuthentication(): Promise<void> {
    const endpoint = '/api/2.0/fo/activity_log/';

    try {
      await this.executeAuthenticatedAPIRequest(
        this.qualysUrl(endpoint, {
          action: 'list',
          username: this.config.qualysUsername,
          truncation_limit: 1,
        }),
        {
          method: 'GET',
        },
      );
    } catch (err) {
      throw new IntegrationProviderAuthenticationError({
        cause: err,
        endpoint,
        status: err.status,
        statusText: err.statusText,
      });
    }
  }

  public async fetchPortalInfo(): Promise<PortalInfo | undefined> {
    const endpoint = '/qps/rest/portal/version';

    try {
      const response = await this.executeAuthenticatedAPIRequest(
        this.qualysUrl(endpoint, {}),
        {
          method: 'GET',
        },
      );

      const responseText = await response.text();
      return xmlParser.parse(responseText).ServiceResponse?.data as PortalInfo;
    } catch (err) {
      return undefined;
    }
  }

  /**
   * Iterate web applications. Details are minimal, it is necessary to request
   * details in a separate call.
   */
  public async iterateWebApps(
    iteratee: ResourceIteratee<was.WebApp>,
    options?: {
      filters?: was.ListWebAppsFilters;
      pagination?: was.ListWebAppsPagination;
    },
  ): Promise<void> {
    const endpoint = '/qps/rest/3.0/search/was/webapp';

    const filterXml = options?.filters ? buildFilterXml(options.filters) : '';

    const body = ({ limit, offset }: { limit: number; offset: number }) => {
      return `
        <ServiceRequest>
          <preferences>
            <limitResults>${limit}</limitResults>
            <startFromOffset>${offset}</startFromOffset>
          </preferences>
          ${filterXml}
        </ServiceRequest>`;
    };

    // The WAS APIs have no rate limits on them; iterate in smaller batches to
    // keep memory pressure low.
    const limit = options?.pagination?.limit || 100;
    let offset = options?.pagination?.offset || 1;

    let hasMoreRecords = true;
    do {
      const response = await this.executeAuthenticatedAPIRequest(
        this.qualysUrl(endpoint, {}),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml',
          },
          body: body({ limit, offset }),
        },
      );

      const responseText = await response.text();
      const jsonFromXml = xmlParser.parse(
        responseText,
      ) as was.ListWebAppsResponse;

      const responseCode = jsonFromXml.ServiceResponse?.responseCode;
      if (responseCode && responseCode !== 'SUCCESS') {
        throw new IntegrationProviderAPIError({
          cause: new Error(
            `Unexpected responseCode in ServiceResponse: ${responseCode}`,
          ),
          endpoint,
          status: response.status,
          statusText: responseCode,
        });
      }

      for (const webApp of toArray(jsonFromXml.ServiceResponse?.data?.WebApp)) {
        await iteratee(webApp);
      }

      hasMoreRecords = !!jsonFromXml.ServiceResponse?.hasMoreRecords;

      if (hasMoreRecords) {
        offset += limit;
      }
    } while (hasMoreRecords);
  }

  /**
   * Answers the complete set of host IDs.
   *
   * There are three IDs in Qualys. These are the VM module ("QWEB") host IDs.
   *
   * @see https://qualys-secure.force.com/discussions/s/article/000006216 to
   * understand the difference.
   */
  public async fetchHostIds(): Promise<number[]> {
    const endpoint = '/api/2.0/fo/asset/host/';

    const response = await this.executeAuthenticatedAPIRequest(
      this.qualysUrl(endpoint, {
        action: 'list',
        details: 'None',
        // Fetch all IDs in a single request
        truncation_limit: 0,
      }),
      {
        method: 'GET',
      },
    );

    const responseText = await response.text();
    const jsonFromXml = xmlParser.parse(responseText);
    return toArray(jsonFromXml.HOST_LIST_OUTPUT?.RESPONSE?.ID_SET).map(
      (e) => e.ID,
    );
  }

  /**
   * Fetch host details from asset manager.
   *
   * @param hostId a QWEB host ID
   */
  public async fetchHostDetails(hostId: number): Promise<assets.HostAsset> {
    const endpoint = '/qps/rest/2.0/search/am/hostasset';

    const body = `
    <ServiceRequest>
      <preferences>
        <limitResults>1</limitResults>
      </preferences>
      <filters>
        <Criteria field="qwebHostId" operator="EQUALS">${hostId}</Criteria>
      </filters>
    </ServiceRequest>`;

    const response = await this.executeAuthenticatedAPIRequest(
      this.qualysUrl(endpoint, {}),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml',
        },
        body,
      },
    );

    const responseText = await response.text();
    const jsonFromXml = xmlParser.parse(
      responseText,
    ) as assets.GetHostAssetResponse;

    const responseCode = jsonFromXml.ServiceResponse?.responseCode;
    if (responseCode && responseCode !== 'SUCCESS') {
      throw new IntegrationProviderAPIError({
        cause: new Error(
          `Unexpected responseCode in ServiceResponse: ${responseCode}`,
        ),
        endpoint,
        status: response.status,
        statusText: responseCode,
      });
    }

    return jsonFromXml.ServiceResponse?.data?.HostAsset as assets.HostAsset;
  }

  /**
   * Iterate detected host vulnerabilities.
   *
   * These are not the vulnerabilities themselves, which come from a
   * vulnerability database by QID, but the findings of vulnerabilities for a
   * host.
   *
   * @param hostIds the set of QWEB host IDs to fetch detections
   * @param iteratee receives each host and its detections
   */
  public async iterateHostDetections(
    hostIds: number[],
    iteratee: ResourceIteratee<{
      host: vmpc.DetectionHost;
      detections: vmpc.HostDetection[];
    }>,
  ): Promise<void> {
    const fetchHostDetections = async (ids: number[]) => {
      const endpoint = '/api/2.0/fo/asset/host/vm/detection/';

      const params = new URLSearchParams({
        action: 'list',
        show_tags: '1',
        show_igs: '1',
        output_format: 'XML',
        ids: ids.map(String),
      });

      const response = await this.executeAuthenticatedAPIRequest(
        this.qualysUrl(endpoint),
        { method: 'POST', body: params },
      );

      const responseText = await response.text();
      const jsonFromXml = xmlParser.parse(responseText);
      const detectionHosts: vmpc.DetectionHost[] = toArray(
        jsonFromXml.HOST_LIST_VM_DETECTION_OUTPUT?.RESPONSE?.HOST_LIST?.HOST,
      );

      for (const host of detectionHosts) {
        await iteratee({
          host,
          detections: toArray(host.DETECTION_LIST?.DETECTION),
        });
      }
    };

    // Starting simple, sequential requests for pages. Once client supports
    // concurrency, add to queue to allow concurrency control.
    for (const ids of chunk(hostIds, 500)) {
      await fetchHostDetections(ids);
    }
  }

  private async executeAuthenticatedAPIRequest(
    info: RequestInfo,
    init: RequestInit,
  ): Promise<Response> {
    return this.executeAPIRequest(info, {
      ...init,
      headers: {
        ...init.headers,
        'x-requested-with': '@jupiterone/graph-qualys',
        authorization: this.qualysAuthorization(),
      },
      size: 0,
      timeout: 0,
    });
  }

  private async executeAPIRequest(
    info: RequestInfo,
    init: RequestInit,
  ): Promise<Response> {
    const apiResponse = await executeAPIRequest(this.events, {
      url: info as string,
      exec: () => fetch(info, init),
      rateLimitConfig: this.rateLimitConfig,
      rateLimitState: this.rateLimitState,
    });

    this.rateLimitState = apiResponse.rateLimitState;

    if (apiResponse.status >= 400) {
      const err = new Error(
        `API request error for ${info}: ${apiResponse.statusText}`,
      );
      Object.assign(err, {
        statusText: apiResponse.statusText,
        status: apiResponse.status,
        code: apiResponse.status,
      });
      throw err;
    }

    return apiResponse.response;
  }

  private qualysAuthorization(): string {
    const authBuffer = Buffer.from(
      `${this.config.qualysUsername}:${this.config.qualysPassword}`,
      'ascii',
    );
    return `Basic ${authBuffer.toString('base64')}`;
  }

  private qualysUrl(
    path: string,
    query?: querystring.ParsedUrlQueryInput,
  ): string {
    if (query) {
      path += '?' + querystring.stringify(query);
    }
    return `${this.config.qualysApiUrl}${path}`;
  }
}