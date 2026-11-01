/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as catalogue from "../catalogue.js";
import type * as http from "../http.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_catalogueDefaults from "../lib/catalogueDefaults.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_specFields from "../lib/specFields.js";
import type * as lib_specValues from "../lib/specValues.js";
import type * as lib_stock from "../lib/stock.js";
import type * as lib_validation from "../lib/validation.js";
import type * as margins from "../margins.js";
import type * as products from "../products.js";
import type * as settings from "../settings.js";
import type * as staff from "../staff.js";
import type * as stock from "../stock.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  catalogue: typeof catalogue;
  http: typeof http;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/catalogueDefaults": typeof lib_catalogueDefaults;
  "lib/money": typeof lib_money;
  "lib/pricing": typeof lib_pricing;
  "lib/specFields": typeof lib_specFields;
  "lib/specValues": typeof lib_specValues;
  "lib/stock": typeof lib_stock;
  "lib/validation": typeof lib_validation;
  margins: typeof margins;
  products: typeof products;
  settings: typeof settings;
  staff: typeof staff;
  stock: typeof stock;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
