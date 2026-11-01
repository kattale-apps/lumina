import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Issued quotations lapse at the end of their validity, which frees their stock holds.
crons.interval("expire quotations", { hours: 1 }, internal.quotations.expireDue, {});

export default crons;
