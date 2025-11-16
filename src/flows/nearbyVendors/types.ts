export interface QueryAnalysis {
  needsLocation: boolean;
  locationName: string | null;
  queryType: string;
}

export interface LocationData {
  latitude: number;
  longitude: number;
  name: string;
}

export interface FlowInput {
  userQuery: string;
  locationName?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
}

export interface FlowOutput {
  ai_voice?: string;
  markdown_text?: string;
  error?: string;
}

