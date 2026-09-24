import { z } from "zod";

export const ModelConnectionCreateInput = z.object({
  name: z.string().trim().min(1).max(50),
  baseUrl: z.string().trim().url().refine((value) => {
    const url = URL.parse(value);
    return url !== null && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  }),
  apiKey: z.string().trim().min(8),
  modelIds: z.array(z.string().trim().min(1)).min(1).max(20),
  isDefaultCompile: z.boolean().default(false),
});
export type ModelConnectionCreateInput = z.infer<typeof ModelConnectionCreateInput>;

export const ModelConnectionSaveInput = z.union([
  ModelConnectionCreateInput.extend({
    id: z.string().uuid(),
    apiKey: z.preprocess((value) => typeof value === "string" && !value.trim() ? undefined : value, ModelConnectionCreateInput.shape.apiKey.optional()),
  }),
  ModelConnectionCreateInput.strict(),
]);
export type ModelConnectionSaveInput = z.infer<typeof ModelConnectionSaveInput>;

// 界面视图：绝不包含密钥明文或密文
export const ModelConnectionView = z.object({
  id: z.string().uuid(),
  name: z.string(),
  baseUrl: z.string(),
  apiKeyHint: z.string(),
  modelIds: z.array(z.string()),
  isDefaultCompile: z.boolean(),
  createdAt: z.string(),
});
export type ModelConnectionView = z.infer<typeof ModelConnectionView>;

export const PublishModelSelection = z.object({
  connectionId: z.string().uuid(),
  modelId: z.string().trim().min(1),
});
export type PublishModelSelection = z.infer<typeof PublishModelSelection>;
