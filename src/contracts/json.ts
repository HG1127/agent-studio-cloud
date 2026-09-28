import { z } from "zod";

export const JsonStorageValue = z.json();
export type JsonStorageValue = z.infer<typeof JsonStorageValue>;

export const JsonStorageRecord = z.record(z.string(), JsonStorageValue);
export type JsonStorageRecord = z.infer<typeof JsonStorageRecord>;
