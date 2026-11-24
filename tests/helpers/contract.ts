import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { Response } from 'supertest';
import { loadConfig } from '../../src/config/app.config';
import { buildOpenApiDocument } from '../../src/docs/openapi';

/**
 * Validates real HTTP responses against the OpenAPI document served at /docs, so
 * the documented contract and the implementation cannot drift apart unnoticed.
 */
interface Operation {
  responses: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}

const document = buildOpenApiDocument(loadConfig({ NODE_ENV: 'test', AUTH_DISABLED: 'true' })) as {
  paths: Record<string, Record<string, Operation>>;
  components: unknown;
};

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'openapi.json', components: document.components });

const compiled = new Map<string, ValidateFunction>();
const compile = (key: string, schema: unknown): ValidateFunction => {
  let validate = compiled.get(key);
  if (validate === undefined) {
    // Point local "#/components/..." references at the registered document.
    const rewritten = JSON.parse(
      JSON.stringify(schema).replaceAll('"#/components/', '"openapi.json#/components/'),
    ) as object;
    validate = ajv.compile(rewritten);
    compiled.set(key, validate);
  }
  return validate;
};

/** Every (operation, status) that a test has checked, to prove the whole contract is exercised. */
export const coveredResponses = new Set<string>();
export const seenErrorCodes = new Set<string>();

export const documentedResponses = (): string[] =>
  Object.entries(document.paths).flatMap(([path, operations]) =>
    Object.entries(operations).flatMap(([method, operation]) =>
      Object.keys(operation.responses).map((status) => `${method.toUpperCase()} ${path} ${status}`),
    ),
  );

const recordErrorCode = (body: unknown): void => {
  const code = (body as { error?: { code?: unknown } } | undefined)?.error?.code;
  if (typeof code === 'string') seenErrorCodes.add(code);
};

export const expectToMatchContract = (
  response: Response,
  method: 'get' | 'post',
  path: string,
): void => {
  const operation = document.paths[path]?.[method];
  if (operation === undefined) throw new Error(`${method.toUpperCase()} ${path} is not documented`);

  const status = String(response.status);
  const documented = operation.responses[status];
  if (documented === undefined) {
    throw new Error(`${method.toUpperCase()} ${path} returned ${status}, which is not documented`);
  }

  const schema = documented.content?.['application/json']?.schema;
  if (schema !== undefined) {
    const validate = compile(`${method} ${path} ${status}`, schema);
    if (!validate(response.body)) {
      throw new Error(
        `Response does not match the documented schema for ${method.toUpperCase()} ${path} ${status}:\n` +
          ajv.errorsText(validate.errors, { separator: '\n' }),
      );
    }
  }
  coveredResponses.add(`${method.toUpperCase()} ${path} ${status}`);
  recordErrorCode(response.body);
};

/** For responses outside any documented operation (unknown route, wrong method). */
export const expectErrorShape = (response: Response): void => {
  const validate = compile('Error', { $ref: '#/components/schemas/Error' });
  if (!validate(response.body)) {
    throw new Error(
      `Error body does not match the Error schema:\n${ajv.errorsText(validate.errors)}`,
    );
  }
  recordErrorCode(response.body);
};
