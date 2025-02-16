/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * The OpenSearch Contributors require contributions made to
 * this file be licensed under the Apache-2.0 license or a
 * compatible open source license.
 *
 * Modifications Copyright OpenSearch Contributors. See
 * GitHub history for details.
 */

/*
 * Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import { schema } from '@osd/config-schema';
import {
  IRouter,
  IOpenSearchDashboardsResponse,
  ResponseError,
  Logger,
  ILegacyScopedClusterClient,
} from '../../../../src/core/server';
import { API_PREFIX } from '../../common';
import { createReport } from './lib/createReport';
import { checkErrorType, errorResponse } from './utils/helpers';
import { DEFAULT_MAX_SIZE, DELIVERY_TYPE } from './utils/constants';
import {
  backendToUiReport,
  backendToUiReportsList,
} from './utils/converters/backendToUi';
import { addToMetric } from './utils/metricHelper';
import { validateReport } from '../../server/utils/validationHelper';
import { AccessInfoType } from 'server';

export default function (router: IRouter, accessInfo: AccessInfoType) {
  const { basePath } = accessInfo;
  // generate report (with provided metadata)
  router.post(
    {
      path: `${API_PREFIX}/generateReport`,
      validate: {
        body: schema.any(),
        query: schema.object({
          timezone: schema.maybe(schema.string()),
        }),
      },
    },
    async (
      context,
      request,
      response
    ): Promise<IOpenSearchDashboardsResponse<any | ResponseError>> => {
      addToMetric('report', 'create', 'count');
      //@ts-ignore
      const logger: Logger = context.reporting_plugin.logger;
      let report = request.body;

      // input validation
      try {
        report.report_definition.report_params.core_params.origin =
          request.headers.origin;
        report = await validateReport(
          context.core.opensearch.legacy.client,
          report,
          basePath
        );
      } catch (error) {
        logger.error(`Failed input validation for create report ${error}`);
        addToMetric('report', 'create', 'user_error');
        return response.badRequest({ body: error });
      }

      try {
        const reportData = await createReport(
          request,
          context,
          report,
          accessInfo
        );

        // if not deliver to user himself , no need to send actual file data to client
        const delivery = report.report_definition.delivery;
        addToMetric('report', 'create', 'count', report);
        return response.ok({
          body: {
            data: reportData.dataUrl,
            filename: reportData.fileName,
          },
        });
      } catch (error) {
        // TODO: better error handling for delivery and stages in generating report, pass logger to deeper level
        logger.error(`Failed to generate report: ${error}`);
        logger.error(error);
        addToMetric('report', 'create', checkErrorType(error));
        return errorResponse(response, error);
      }
    }
  );

  // generate report from report id
  router.get(
    {
      path: `${API_PREFIX}/generateReport/{reportId}`,
      validate: {
        params: schema.object({
          reportId: schema.string(),
        }),
        query: schema.object({
          timezone: schema.string(),
        }),
      },
    },
    async (
      context,
      request,
      response
    ): Promise<IOpenSearchDashboardsResponse<any | ResponseError>> => {
      addToMetric('report', 'download', 'count');
      //@ts-ignore
      const logger: Logger = context.reporting_plugin.logger;
      let report: any;
      try {
        const savedReportId = request.params.reportId;
        // @ts-ignore
        const opensearchReportsClient: ILegacyScopedClusterClient = context.reporting_plugin.opensearchReportsClient.asScoped(
          request
        );
        // get report
        const opensearchResp = await opensearchReportsClient.callAsCurrentUser(
          'opensearch_reports.getReportById',
          {
            reportInstanceId: savedReportId,
          }
        );
        // convert report to use UI model
        const report = backendToUiReport(opensearchResp.reportInstance, basePath);
        // generate report
        const reportData = await createReport(
          request,
          context,
          report,
          accessInfo,
          savedReportId
        );
        addToMetric('report', 'download', 'count', report);

        return response.ok({
          body: {
            data: reportData.dataUrl,
            filename: reportData.fileName,
          },
        });
      } catch (error) {
        logger.error(`Failed to generate report by id: ${error}`);
        logger.error(error);
        addToMetric('report', 'download', checkErrorType(error));
        return errorResponse(response, error);
      }
    }
  );

  // create report from existing report definition
  router.post(
    {
      path: `${API_PREFIX}/generateReport/{reportDefinitionId}`,
      validate: {
        params: schema.object({
          reportDefinitionId: schema.string(),
        }),
        query: schema.object({
          timezone: schema.string(),
        }),
      },
    },
    async (
      context,
      request,
      response
    ): Promise<IOpenSearchDashboardsResponse<any | ResponseError>> => {
      addToMetric('report', 'create_from_definition', 'count');
      //@ts-ignore
      const logger: Logger = context.reporting_plugin.logger;
      const reportDefinitionId = request.params.reportDefinitionId;
      let report: any;
      try {
        // @ts-ignore
        const opensearchReportsClient: ILegacyScopedClusterClient = context.reporting_plugin.opensearchReportsClient.asScoped(
          request
        );
        // call OpenSearch API to create report from definition
        const opensearchResp = await opensearchReportsClient.callAsCurrentUser(
          'opensearch_reports.createReportFromDefinition',
          {
            reportDefinitionId: reportDefinitionId,
            body: {
              reportDefinitionId: reportDefinitionId,
            },
          }
        );
        const reportId = opensearchResp.reportInstance.id;
        // convert report to use UI model
        const report = backendToUiReport(opensearchResp.reportInstance, basePath);
        // generate report
        const reportData = await createReport(
          request,
          context,
          report,
          accessInfo,
          reportId
        );
        addToMetric('report', 'create_from_definition', 'count', report);

        return response.ok({
          body: {
            data: reportData.dataUrl,
            filename: reportData.fileName,
          },
        });
      } catch (error) {
        logger.error(
          `Failed to generate report from reportDefinition id ${reportDefinitionId} : ${error}`
        );
        logger.error(error);
        addToMetric('report', 'create_from_definition', checkErrorType(error));
        return errorResponse(response, error);
      }
    }
  );

  // get all reports details
  router.get(
    {
      path: `${API_PREFIX}/reports`,
      validate: {
        query: schema.object({
          fromIndex: schema.maybe(schema.number()),
          maxItems: schema.maybe(schema.number()),
        }),
      },
    },
    async (
      context,
      request,
      response
    ): Promise<IOpenSearchDashboardsResponse<any | ResponseError>> => {
      addToMetric('report', 'list', 'count');
      const { fromIndex, maxItems } = request.query as {
        fromIndex: number;
        maxItems: number;
      };

      try {
        // @ts-ignore
        const opensearchReportsClient: ILegacyScopedClusterClient = context.reporting_plugin.opensearchReportsClient.asScoped(
          request
        );
        const opensearchResp = await opensearchReportsClient.callAsCurrentUser(
          'opensearch_reports.getReports',
          {
            fromIndex: fromIndex,
            maxItems: maxItems || DEFAULT_MAX_SIZE,
          }
        );

        const reportsList = backendToUiReportsList(
          opensearchResp.reportInstanceList,
          basePath
        );

        return response.ok({
          body: {
            data: reportsList,
          },
        });
      } catch (error) {
        //@ts-ignore
        context.reporting_plugin.logger.error(
          `Failed to get reports details: ${error}`
        );
        addToMetric('report', 'list', checkErrorType(error));
        return errorResponse(response, error);
      }
    }
  );

  // get single report details by id
  router.get(
    {
      path: `${API_PREFIX}/reports/{reportId}`,
      validate: {
        params: schema.object({
          reportId: schema.string(),
        }),
      },
    },
    async (
      context,
      request,
      response
    ): Promise<IOpenSearchDashboardsResponse<any | ResponseError>> => {
      addToMetric('report', 'info', 'count');
      try {
        // @ts-ignore
        const opensearchReportsClient: ILegacyScopedClusterClient = context.reporting_plugin.opensearchReportsClient.asScoped(
          request
        );

        const opensearchResp = await opensearchReportsClient.callAsCurrentUser(
          'opensearch_reports.getReportById',
          {
            reportInstanceId: request.params.reportId,
          }
        );

        const report = backendToUiReport(opensearchResp.reportInstance, basePath);

        return response.ok({
          body: report,
        });
      } catch (error) {
        //@ts-ignore
        context.reporting_plugin.logger.error(
          `Failed to get single report details: ${error}`
        );
        addToMetric('report', 'info', checkErrorType(error));
        return errorResponse(response, error);
      }
    }
  );
}
