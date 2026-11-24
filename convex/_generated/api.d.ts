/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as academy from "../academy.js";
import type * as access from "../access.js";
import type * as admin from "../admin.js";
import type * as appliances from "../appliances.js";
import type * as assessments from "../assessments.js";
import type * as auth from "../auth.js";
import type * as budget from "../budget.js";
import type * as catalogue from "../catalogue.js";
import type * as catalogueImport from "../catalogueImport.js";
import type * as checks from "../checks.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as estimator from "../estimator.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as i18n from "../i18n.js";
import type * as inbox from "../inbox.js";
import type * as itemRequests from "../itemRequests.js";
import type * as leads from "../leads.js";
import type * as lib_academy from "../lib/academy.js";
import type * as lib_academyContent from "../lib/academyContent.js";
import type * as lib_academyI18n_ach from "../lib/academyI18n/ach.js";
import type * as lib_academyI18n_index from "../lib/academyI18n/index.js";
import type * as lib_academyI18n_lg from "../lib/academyI18n/lg.js";
import type * as lib_academyI18n_nyn from "../lib/academyI18n/nyn.js";
import type * as lib_academyI18n_sw from "../lib/academyI18n/sw.js";
import type * as lib_academyI18n_teo from "../lib/academyI18n/teo.js";
import type * as lib_academyI18n_xog from "../lib/academyI18n/xog.js";
import type * as lib_applianceDefaults from "../lib/applianceDefaults.js";
import type * as lib_applianceGuide from "../lib/applianceGuide.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_budget from "../lib/budget.js";
import type * as lib_catalogueDefaults from "../lib/catalogueDefaults.js";
import type * as lib_crm from "../lib/crm.js";
import type * as lib_estimate from "../lib/estimate.js";
import type * as lib_files from "../lib/files.js";
import type * as lib_finance from "../lib/finance.js";
import type * as lib_itemTypes from "../lib/itemTypes.js";
import type * as lib_languages from "../lib/languages.js";
import type * as lib_load from "../lib/load.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_priority from "../lib/priority.js";
import type * as lib_quote from "../lib/quote.js";
import type * as lib_quotePdf from "../lib/quotePdf.js";
import type * as lib_requester from "../lib/requester.js";
import type * as lib_search from "../lib/search.js";
import type * as lib_shopParts from "../lib/shopParts.js";
import type * as lib_signup from "../lib/signup.js";
import type * as lib_sizing from "../lib/sizing.js";
import type * as lib_specEstimate from "../lib/specEstimate.js";
import type * as lib_specFields from "../lib/specFields.js";
import type * as lib_specValues from "../lib/specValues.js";
import type * as lib_stock from "../lib/stock.js";
import type * as lib_tariff from "../lib/tariff.js";
import type * as lib_upgrade from "../lib/upgrade.js";
import type * as lib_validation from "../lib/validation.js";
import type * as lib_whatsapp from "../lib/whatsapp.js";
import type * as lib_whatsappRoute from "../lib/whatsappRoute.js";
import type * as margins from "../margins.js";
import type * as operations from "../operations.js";
import type * as pdfLinks from "../pdfLinks.js";
import type * as products from "../products.js";
import type * as profile from "../profile.js";
import type * as quotations from "../quotations.js";
import type * as requestPhotos from "../requestPhotos.js";
import type * as responses from "../responses.js";
import type * as salesDocuments from "../salesDocuments.js";
import type * as salesLog from "../salesLog.js";
import type * as settings from "../settings.js";
import type * as shop from "../shop.js";
import type * as sizing from "../sizing.js";
import type * as staff from "../staff.js";
import type * as stock from "../stock.js";
import type * as sync from "../sync.js";
import type * as upgrades from "../upgrades.js";
import type * as users from "../users.js";
import type * as whatsappAgents from "../whatsappAgents.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  academy: typeof academy;
  access: typeof access;
  admin: typeof admin;
  appliances: typeof appliances;
  assessments: typeof assessments;
  auth: typeof auth;
  budget: typeof budget;
  catalogue: typeof catalogue;
  catalogueImport: typeof catalogueImport;
  checks: typeof checks;
  crons: typeof crons;
  customers: typeof customers;
  estimator: typeof estimator;
  files: typeof files;
  http: typeof http;
  i18n: typeof i18n;
  inbox: typeof inbox;
  itemRequests: typeof itemRequests;
  leads: typeof leads;
  "lib/academy": typeof lib_academy;
  "lib/academyContent": typeof lib_academyContent;
  "lib/academyI18n/ach": typeof lib_academyI18n_ach;
  "lib/academyI18n/index": typeof lib_academyI18n_index;
  "lib/academyI18n/lg": typeof lib_academyI18n_lg;
  "lib/academyI18n/nyn": typeof lib_academyI18n_nyn;
  "lib/academyI18n/sw": typeof lib_academyI18n_sw;
  "lib/academyI18n/teo": typeof lib_academyI18n_teo;
  "lib/academyI18n/xog": typeof lib_academyI18n_xog;
  "lib/applianceDefaults": typeof lib_applianceDefaults;
  "lib/applianceGuide": typeof lib_applianceGuide;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/budget": typeof lib_budget;
  "lib/catalogueDefaults": typeof lib_catalogueDefaults;
  "lib/crm": typeof lib_crm;
  "lib/estimate": typeof lib_estimate;
  "lib/files": typeof lib_files;
  "lib/finance": typeof lib_finance;
  "lib/itemTypes": typeof lib_itemTypes;
  "lib/languages": typeof lib_languages;
  "lib/load": typeof lib_load;
  "lib/money": typeof lib_money;
  "lib/pricing": typeof lib_pricing;
  "lib/priority": typeof lib_priority;
  "lib/quote": typeof lib_quote;
  "lib/quotePdf": typeof lib_quotePdf;
  "lib/requester": typeof lib_requester;
  "lib/search": typeof lib_search;
  "lib/shopParts": typeof lib_shopParts;
  "lib/signup": typeof lib_signup;
  "lib/sizing": typeof lib_sizing;
  "lib/specEstimate": typeof lib_specEstimate;
  "lib/specFields": typeof lib_specFields;
  "lib/specValues": typeof lib_specValues;
  "lib/stock": typeof lib_stock;
  "lib/tariff": typeof lib_tariff;
  "lib/upgrade": typeof lib_upgrade;
  "lib/validation": typeof lib_validation;
  "lib/whatsapp": typeof lib_whatsapp;
  "lib/whatsappRoute": typeof lib_whatsappRoute;
  margins: typeof margins;
  operations: typeof operations;
  pdfLinks: typeof pdfLinks;
  products: typeof products;
  profile: typeof profile;
  quotations: typeof quotations;
  requestPhotos: typeof requestPhotos;
  responses: typeof responses;
  salesDocuments: typeof salesDocuments;
  salesLog: typeof salesLog;
  settings: typeof settings;
  shop: typeof shop;
  sizing: typeof sizing;
  staff: typeof staff;
  stock: typeof stock;
  sync: typeof sync;
  upgrades: typeof upgrades;
  users: typeof users;
  whatsappAgents: typeof whatsappAgents;
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
