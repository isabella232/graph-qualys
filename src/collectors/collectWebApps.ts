import QualysClient from '../provider/QualysClient';
import pAll, { PromiseFactory } from 'p-all';
import toArray from '../util/toArray';
import { IntegrationStepExecutionContext } from '@jupiterone/integration-sdk';
import { convertWebAppToEntity } from '../converters';

export default async function collectWebApps(
  context: IntegrationStepExecutionContext,
  options: {
    qualysClient: QualysClient;
  },
) {
  const { logger } = context;

  logger.info('Collecting web apps...');

  const { qualysClient } = options;

  const paginator = await qualysClient.webApplicationScanning.listWebApps({
    limit: 1000,
    isScanned: true,
  });

  const webAppScanIdSet = new Set<number>();
  const webAppWork: PromiseFactory<void>[] = [];

  do {
    logger.info('Fetching page of web apps...');

    const result = await paginator.nextPage();

    const webApps = toArray(result.responseData.ServiceResponse?.data?.WebApp);

    logger.info(
      {
        numWebApps: webApps.length,
      },
      'Fetched page of web apps',
    );

    await context.jobState.addEntities(
      webApps.map((webApp) => {
        webAppWork.push(async () => {
          const {
            responseData,
          } = await qualysClient.webApplicationScanning.fetchWebApp({
            webAppId: webApp.id!,
          });

          const lastScanId =
            responseData.ServiceResponse?.data?.WebApp?.lastScan?.id;
          if (lastScanId !== undefined) {
            webAppScanIdSet.add(lastScanId);
          }
        });

        return convertWebAppToEntity({ webApp });
      }),
    );
  } while (paginator.hasNextPage());

  await pAll(webAppWork, {
    concurrency: 5,
  });

  logger.info('Finished collecting web apps');

  return {
    webAppScanIdSet,
  };
}
