import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import type { AppConfig } from '../config/app.config';
import { buildOpenApiDocument } from '../docs/openapi';

export const createDocsRouter = (config: AppConfig): Router => {
  const document = buildOpenApiDocument(config);
  const router = Router();

  router.get('/openapi.json', (_req, res) => {
    res.json(document);
  });
  router.use('/', swaggerUi.serve, swaggerUi.setup(document));

  return router;
};
