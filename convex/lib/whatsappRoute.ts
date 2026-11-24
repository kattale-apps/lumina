import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type WhatsappRoute = { number: string; name: string; userId?: Id<"userProfiles"> };

/**
 * The WhatsApp number a new public request goes to. Agents' numbers take turns, so requests are
 * shared out evenly; with none set, the company number. Null when WhatsApp is not set up.
 */
export async function nextWhatsapp(ctx: MutationCtx, settings: Doc<"publicEstimatorSettings">): Promise<WhatsappRoute | null> {
  const agents = settings.whatsappAgents ?? [];
  if (agents.length === 0) {
    return settings.whatsappNumber ? { number: settings.whatsappNumber, name: "Company WhatsApp" } : null;
  }
  const turn = settings.whatsappTurn ?? 0;
  await ctx.db.patch(settings._id, { whatsappTurn: turn + 1 });
  return agents[turn % agents.length];
}
