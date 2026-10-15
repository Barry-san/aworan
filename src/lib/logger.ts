import { pino } from "pino";

// JSON logs work with production-only dependency installs and log collectors.
export const logger = pino();
