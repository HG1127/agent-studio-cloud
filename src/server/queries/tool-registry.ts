import type { ToolRegistryOption } from "@/contracts/tool-registry";
import { listToolRegistryOptions } from "@/server/tools/tool-registry";

export { listToolRegistryOptions };

export type VisibleToolRegistryOption = Pick<ToolRegistryOption, "id" | "name" | "description" | "risk">;

export function listVisibleToolRegistry(): VisibleToolRegistryOption[] {
  return listToolRegistryOptions().map(({ id, name, description, risk }) => ({ id, name, description, risk }));
}
