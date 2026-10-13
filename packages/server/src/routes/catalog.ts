import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { isUnit, volumeUnits, weightUnits } from '@stockup/domain';
import type { Context } from 'hono';
import type { Auth } from '../auth';
import {
  createCategory,
  createCategoryGroup,
  createProduct,
  deleteCategory,
  deleteCategoryGroup,
  deleteProduct,
  findProduct,
  listCatalog,
  listProducts,
  updateCategory,
  updateCategoryGroup,
  updateProduct,
} from '../catalog';
import type { Database } from '../db';
import { NameTakenError, NotEmptyError, ParentNotFoundError } from '../db/errors';
import { requireMember } from '../members';
import { lowestUnitPrice } from '../price-records';

const errorSchema = z.object({ error: z.string() });
const errorContent = { 'application/json': { schema: errorSchema } };
const name = z.string().trim().min(1).max(50);
const idParams = z.object({ id: z.string() });

const atLeastOne = (value: object) => Object.values(value).some((v) => v !== undefined);
const nothingToChange = { message: 'Provide at least one field to change' };

const categoryGroupSchema = z.object({ id: z.string(), name: z.string() }).openapi('CategoryGroup');

const catalogSchema = z
  .array(
    categoryGroupSchema.extend({
      categories: z.array(z.object({ id: z.string(), name: z.string(), productCount: z.number().int() })),
    }),
  )
  .openapi('Catalog');

const categorySchema = z
  .object({ id: z.string(), name: z.string(), categoryGroupId: z.string() })
  .openapi('Category');

export const pricingUnitSchema = z
  .object({ dimension: z.enum(['weight', 'volume', 'count']), name: z.string().max(10) })
  .refine(isUnit, { message: 'Not a valid unit for its dimension' })
  .openapi('PricingUnit', {
    description: `Weight units: ${weightUnits.join(', ')}. Volume units: ${volumeUnits.join(', ')}. A count unit takes any other name, such as 抽 or 片.`,
    example: { dimension: 'count', name: '抽' },
  });

const productSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    categoryId: z.string(),
    pricingUnit: pricingUnitSchema,
    baseSize: z.number().openapi({ description: 'Base Size in the pricing unit', example: 90 }),
    stockLine: z
      .number()
      .int()
      .nullable()
      .openapi({ description: 'Unit price, in cents per base size, at or below which a price is worth stocking up' }),
    note: z.string(),
  })
  .openapi('Product');

const productDetailSchema = productSchema
  .extend({
    lowestUnitPrice: z
      .number()
      .nullable()
      .openapi({ description: 'Lowest unit price across all its price records, null without any' }),
  })
  .openapi('ProductDetail');

const note = z.string().trim().max(500);

const newProductSchema = z.object({
  categoryId: z.string(),
  name: z.string().trim().min(1).max(100),
  pricingUnit: pricingUnitSchema,
  baseSize: z.number().positive().finite(),
  note: note.optional(),
});

const productChangesSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    categoryId: z.string().optional(),
    note: note.optional(),
    // Postgres integer columns hold amounts up to 2^31 - 1.
    stockLine: z
      .number()
      .int()
      .positive()
      .max(2_000_000_000)
      .nullable()
      .optional()
      .openapi({ description: 'Cents per base size; null clears it' }),
  })
  .refine(atLeastOne, nothingToChange);

function json<T extends z.ZodType>(schema: T) {
  return { content: { 'application/json': { schema } }, required: true };
}

// Turns the catalog service's domain errors into responses; anything else propagates.
function respondToError(c: Context, error: unknown, missingParent?: string) {
  if (error instanceof NameTakenError) return c.json({ error: 'name_taken' }, 409);
  if (error instanceof NotEmptyError) return c.json({ error: 'not_empty' }, 409);
  if (error instanceof ParentNotFoundError && missingParent) return c.json({ error: missingParent }, 422);
  throw error;
}

export function catalogRoutes(db: Database, auth: Auth) {
  const middleware = requireMember(auth, db);
  const unauthenticated = { 401: { description: 'Not signed in' } };
  const notFound = { 404: { description: 'No such record in this household', content: errorContent } };
  const nameTaken = { 409: { description: 'The household already uses this name', content: errorContent } };

  const listCatalogRoute = createRoute({
    method: 'get',
    path: '/category-groups',
    tags: ['catalog'],
    summary: "List the household's category groups with their categories",
    middleware,
    responses: {
      200: { description: 'Category groups', content: { 'application/json': { schema: catalogSchema } } },
      ...unauthenticated,
    },
  });

  const createGroupRoute = createRoute({
    method: 'post',
    path: '/category-groups',
    tags: ['catalog'],
    summary: 'Create a category group',
    middleware,
    request: { body: json(z.object({ name })) },
    responses: {
      201: { description: 'Created', content: { 'application/json': { schema: categoryGroupSchema } } },
      ...unauthenticated,
      ...nameTaken,
    },
  });

  const updateGroupRoute = createRoute({
    method: 'patch',
    path: '/category-groups/{id}',
    tags: ['catalog'],
    summary: 'Rename a category group',
    middleware,
    request: { params: idParams, body: json(z.object({ name })) },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: categoryGroupSchema } } },
      ...unauthenticated,
      ...notFound,
      ...nameTaken,
    },
  });

  const deleteGroupRoute = createRoute({
    method: 'delete',
    path: '/category-groups/{id}',
    tags: ['catalog'],
    summary: 'Delete a category group that has no categories',
    middleware,
    request: { params: idParams },
    responses: {
      204: { description: 'Deleted' },
      ...unauthenticated,
      ...notFound,
      409: { description: 'The group still has categories', content: errorContent },
    },
  });

  const createCategoryRoute = createRoute({
    method: 'post',
    path: '/categories',
    tags: ['catalog'],
    summary: 'Create a category in a category group',
    middleware,
    request: { body: json(z.object({ name, categoryGroupId: z.string() })) },
    responses: {
      201: { description: 'Created', content: { 'application/json': { schema: categorySchema } } },
      ...unauthenticated,
      ...nameTaken,
      422: { description: 'No such category group in this household', content: errorContent },
    },
  });

  const updateCategoryRoute = createRoute({
    method: 'patch',
    path: '/categories/{id}',
    tags: ['catalog'],
    summary: 'Rename a category or move it to another category group',
    middleware,
    request: {
      params: idParams,
      body: json(
        z.object({ name: name.optional(), categoryGroupId: z.string().optional() }).refine(atLeastOne, nothingToChange),
      ),
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: categorySchema } } },
      ...unauthenticated,
      ...notFound,
      ...nameTaken,
      422: { description: 'No such category group in this household', content: errorContent },
    },
  });

  const deleteCategoryRoute = createRoute({
    method: 'delete',
    path: '/categories/{id}',
    tags: ['catalog'],
    summary: 'Delete a category that has no products',
    middleware,
    request: { params: idParams },
    responses: {
      204: { description: 'Deleted' },
      ...unauthenticated,
      ...notFound,
      409: { description: 'The category still has products', content: errorContent },
    },
  });

  const listProductsRoute = createRoute({
    method: 'get',
    path: '/products',
    tags: ['catalog'],
    summary: "List the household's products",
    middleware,
    request: { query: z.object({ categoryId: z.string().optional() }) },
    responses: {
      200: { description: 'Products', content: { 'application/json': { schema: z.array(productSchema) } } },
      ...unauthenticated,
    },
  });

  const getProductRoute = createRoute({
    method: 'get',
    path: '/products/{id}',
    tags: ['catalog'],
    summary: 'Get a product with its lowest unit price',
    middleware,
    request: { params: idParams },
    responses: {
      200: { description: 'The product', content: { 'application/json': { schema: productDetailSchema } } },
      ...unauthenticated,
      ...notFound,
    },
  });

  const createProductRoute = createRoute({
    method: 'post',
    path: '/products',
    tags: ['catalog'],
    summary: 'Create a product in a category',
    middleware,
    request: { body: json(newProductSchema) },
    responses: {
      201: { description: 'Created', content: { 'application/json': { schema: productSchema } } },
      ...unauthenticated,
      422: { description: 'No such category in this household', content: errorContent },
    },
  });

  const updateProductRoute = createRoute({
    method: 'patch',
    path: '/products/{id}',
    tags: ['catalog'],
    summary: 'Rename a product, move it to another category, or change its note or stock line',
    middleware,
    request: { params: idParams, body: json(productChangesSchema) },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: productSchema } } },
      ...unauthenticated,
      ...notFound,
      422: { description: 'No such category in this household', content: errorContent },
    },
  });

  const deleteProductRoute = createRoute({
    method: 'delete',
    path: '/products/{id}',
    tags: ['catalog'],
    summary: 'Delete a product that has no price records',
    middleware,
    request: { params: idParams },
    responses: {
      204: { description: 'Deleted' },
      ...unauthenticated,
      ...notFound,
      409: { description: 'The product still has price records', content: errorContent },
    },
  });

  return new OpenAPIHono()
    .openapi(listCatalogRoute, async (c) => c.json(await listCatalog(db, c.var.member), 200))
    .openapi(createGroupRoute, async (c) => {
      try {
        return c.json(await createCategoryGroup(db, c.var.member, c.req.valid('json')), 201);
      } catch (error) {
        return respondToError(c, error);
      }
    })
    .openapi(updateGroupRoute, async (c) => {
      try {
        const updated = await updateCategoryGroup(db, c.var.member, c.req.valid('param').id, c.req.valid('json'));
        return updated ? c.json(updated, 200) : c.json({ error: 'not_found' }, 404);
      } catch (error) {
        return respondToError(c, error);
      }
    })
    .openapi(deleteGroupRoute, async (c) => {
      try {
        const deleted = await deleteCategoryGroup(db, c.var.member, c.req.valid('param').id);
        return deleted ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
      } catch (error) {
        return respondToError(c, error);
      }
    })
    .openapi(createCategoryRoute, async (c) => {
      try {
        return c.json(await createCategory(db, c.var.member, c.req.valid('json')), 201);
      } catch (error) {
        return respondToError(c, error, 'category_group_not_found');
      }
    })
    .openapi(updateCategoryRoute, async (c) => {
      try {
        const updated = await updateCategory(db, c.var.member, c.req.valid('param').id, c.req.valid('json'));
        return updated ? c.json(updated, 200) : c.json({ error: 'not_found' }, 404);
      } catch (error) {
        return respondToError(c, error, 'category_group_not_found');
      }
    })
    .openapi(deleteCategoryRoute, async (c) => {
      try {
        const deleted = await deleteCategory(db, c.var.member, c.req.valid('param').id);
        return deleted ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
      } catch (error) {
        return respondToError(c, error);
      }
    })
    .openapi(listProductsRoute, async (c) => c.json(await listProducts(db, c.var.member, c.req.valid('query')), 200))
    .openapi(getProductRoute, async (c) => {
      const { id } = c.req.valid('param');
      const [found, lowest] = await Promise.all([
        findProduct(db, c.var.member, id),
        lowestUnitPrice(db, c.var.member, id),
      ]);
      return found ? c.json({ ...found, lowestUnitPrice: lowest }, 200) : c.json({ error: 'not_found' }, 404);
    })
    .openapi(createProductRoute, async (c) => {
      try {
        return c.json(await createProduct(db, c.var.member, c.req.valid('json')), 201);
      } catch (error) {
        return respondToError(c, error, 'category_not_found');
      }
    })
    .openapi(updateProductRoute, async (c) => {
      try {
        const updated = await updateProduct(db, c.var.member, c.req.valid('param').id, c.req.valid('json'));
        return updated ? c.json(updated, 200) : c.json({ error: 'not_found' }, 404);
      } catch (error) {
        return respondToError(c, error, 'category_not_found');
      }
    })
    .openapi(deleteProductRoute, async (c) => {
      try {
        const deleted = await deleteProduct(db, c.var.member, c.req.valid('param').id);
        return deleted ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
      } catch (error) {
        return respondToError(c, error);
      }
    });
}
