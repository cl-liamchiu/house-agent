// Models offered in the UI. Measured on GMI Cloud with a real ~3.5k-token prompt (stove scenario).
export interface ModelOption {
  id: string;
  label: string;
  note: string;
  efforts: string[]; // first = default; "default" = don't send reasoning_effort
}

export const MODELS: ModelOption[] = [
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "~6 s", efforts: ["low", "medium", "default"] },
  { id: "google/gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", note: "~6 s", efforts: ["default"] },
  { id: "zai-org/GLM-5.3-Flash", label: "GLM 5.3 Flash", note: "~13 s", efforts: ["low", "default"] },
  { id: "deepseek-ai/DeepSeek-V4.1-Flash", label: "DeepSeek V4.1 Flash", note: "~17 s", efforts: ["low", "default"] },
];
export const DEFAULT_MODEL = MODELS[0].id;
export const findModel = (id: string) => MODELS.find((m) => m.id === id);
