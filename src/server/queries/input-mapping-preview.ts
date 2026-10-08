import { InputMappingPreviewResult, type InputMappingPreviewResult as InputMappingPreviewResultType } from "@/contracts/input-mapping-preview";
import { resolveInputMappingPreview } from "@/server/domain/runtime/input-mapping-preview";

export async function getInputMappingPreview(raw: unknown): Promise<InputMappingPreviewResultType> {
  return InputMappingPreviewResult.parse(resolveInputMappingPreview(raw));
}
