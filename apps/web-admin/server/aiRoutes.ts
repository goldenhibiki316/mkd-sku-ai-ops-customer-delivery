import type { Express } from 'express';

import { requireAuth } from './authMiddleware';
import type { CoreClient } from './coreClient';
import {
  CoreProtocolError,
  CoreResponseError,
  CoreUnavailableError,
} from './coreClient';
import {
  buildAiAnalysisResponse,
  buildAiHistoryResponse,
  normalizeStoredAnalysisRecord,
  type AiAnalysisReader,
} from './services/ai3a/analysisService';
import type { AiAnalysisRow } from './services/ai3a/repository';

export type AiRouteRepository = AiAnalysisReader & {
  findUsableById: (
    sku: string,
    analysisId: string,
  ) => Promise<AiAnalysisRow | null>;
};

export type AiRouteDependencies = {
  repository: AiRouteRepository;
  coreClient: Pick<CoreClient, 'refreshSku'>;
  skuExists: (sku: string) => Promise<boolean>;
};

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? '' : value;
}

export function registerAiRoutes(
  app: Express,
  dependencies: AiRouteDependencies,
): void {
  const { repository, coreClient, skuExists } = dependencies;

  app.get('/api/skus/:sku/ai-analysis', requireAuth, async (req, res, next) => {
    try {
      res.json(await buildAiAnalysisResponse(
        repository,
        routeParam(req.params.sku),
        { includeHistory: false },
      ));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/skus/:sku/ai/history', requireAuth, async (req, res, next) => {
    try {
      res.json(await buildAiHistoryResponse(
        repository,
        routeParam(req.params.sku),
      ));
    } catch (error) {
      next(error);
    }
  });

  app.get(
    '/api/skus/:sku/ai/history/:analysisId',
    requireAuth,
    async (req, res, next) => {
      try {
        const row = await repository.findUsableById(
          routeParam(req.params.sku),
          routeParam(req.params.analysisId),
        );
        if (!row) {
          res.status(404).json({
            error: {
              code: 'AI_HISTORY_NOT_FOUND',
              message: '未找到该历史分析',
              retryable: false,
            },
          });
          return;
        }
        const normalized = normalizeStoredAnalysisRecord(row);
        res.json({
          analysis: normalized.payload,
          meta: {
            analysis_id: row.analysis_id,
            analysis_status: normalized.status,
            analysis_time: row.finished_at ?? row.created_at,
            model_name: row.model_name,
            iso_year: row.iso_year,
            iso_week: row.iso_week,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post('/api/skus/:sku/ai-refresh', requireAuth, async (req, res, next) => {
    try {
      const sku = routeParam(req.params.sku).trim();
      if (!await skuExists(sku)) {
        res.status(404).json({ error: 'SKU 不存在' });
        return;
      }
      const result = await coreClient.refreshSku({
        sku,
        requestId: req.requestContext?.requestId || 'request-context-missing',
        actorId: req.session.user!.id,
      });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof CoreResponseError) {
        res.status(error.statusCode).json(error.response);
        return;
      }
      if (error instanceof CoreUnavailableError || error instanceof CoreProtocolError) {
        res.status(503).json({
          status: 'core_unavailable',
          message: 'AI 分析核心暂时不可用，历史分析仍可查看',
        });
        return;
      }
      next(error);
    }
  });
}
