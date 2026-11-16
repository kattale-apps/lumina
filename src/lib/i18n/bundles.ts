import type { Lang } from "../../../convex/lib/languages";
import type { MessageKey } from "./en";
import { ach } from "./ach";
import { lg } from "./lg";
import { nyn } from "./nyn";
import { sw } from "./sw";
import { teo } from "./teo";
import { xog } from "./xog";

export type Bundle = Partial<Record<MessageKey, string>>;

/** Draft translations shipped with the app. Missing keys show in English. */
export const BUNDLES: Partial<Record<Lang, Bundle>> = { lg, nyn, sw, ach, xog, teo };
