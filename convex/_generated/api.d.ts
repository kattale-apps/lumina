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
import type * as appliances from "../appliances.js";
import type * as assessments from "../assessments.js";
import type * as auth from "../auth.js";
import type * as catalogue from "../catalogue.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as estimator from "../estimator.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as leads from "../leads.js";
import type * as lib_applianceDefaults from "../lib/applianceDefaults.js";
import type * as lib_applianceGuide from "../lib/applianceGuide.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_catalogueDefaults from "../lib/catalogueDefaults.js";
import type * as lib_crm from "../lib/crm.js";
import type * as lib_estimate from "../lib/estimate.js";
import type * as lib_files from "../lib/files.js";
import type * as lib_finance from "../lib/finance.js";
import type * as lib_load from "../lib/load.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_quote from "../lib/quote.js";
import type * as lib_quotePdf from "../lib/quotePdf.js";
import type * as lib_sizing from "../lib/sizing.js";
import type * as lib_specFields from "../lib/specFields.js";
import type * as lib_specValues from "../lib/specValues.js";
import type * as lib_stock from "../lib/stock.js";
import type * as lib_tariff from "../lib/tariff.js";
import type * as lib_validation from "../lib/validation.js";
import type * as margins from "../margins.js";
import type * as operations from "../operations.js";
import type * as products from "../products.js";
import type * as quotations from "../quotations.js";
import type * as responses from "../responses.js";
import type * as settings from "../settings.js";
import type * as shop from "../shop.js";
import type * as sizing from "../sizing.js";
import type * as staff from "../staff.js";
import type * as stock from "../stock.js";
import type * as sync from "../sync.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  appliances: typeof appliances;
  assessments: typeof assessments;
  auth: typeof auth;
  catalogue: typeof catalogue;
  crons: typeof crons;
  customers: typeof customers;
  estimator: typeof estimator;
  files: typeof files;
  http: typeof http;
  leads: typeof leads;
  "lib/applianceDefaults": typeof lib_applianceDefaults;
  "lib/applianceGuide": typeof lib_applianceGuide;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/catalogueDefaults": typeof lib_catalogueDefaults;
  "lib/crm": typeof lib_crm;
  "lib/estimate": typeof lib_estimate;
  "lib/files": typeof lib_files;
  "lib/finance": typeof lib_finance;
  "lib/load": typeof lib_load;
  "lib/money": typeof lib_money;
  "lib/pricing": typeof lib_pricing;
  "lib/quote": typeof lib_quote;
  "lib/quotePdf": typeof lib_quotePdf;
  "lib/sizing": typeof lib_sizing;
  "lib/specFields": typeof lib_specFields;
  "lib/specValues": typeof lib_specValues;
  "lib/stock": typeof lib_stock;
  "lib/tariff": typeof lib_tariff;
  "lib/validation": typeof lib_validation;
  margins: typeof margins;
  operations: typeof operations;
  products: typeof products;
  quotations: typeof quotations;
  responses: typeof responses;
  settings: typeof settings;
  shop: typeof shop;
  sizing: typeof sizing;
  staff: typeof staff;
  stock: typeof stock;
  sync: typeof sync;
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
