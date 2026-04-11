export interface Template {
  slug: string;
  name: string;
  description: string;
  locked_fields: string[];
  category?: string;
  file?: string;
  ad_data?: Record<string, unknown>;
}

export interface TemplateCreate {
  name: string;
  description?: string;
  locked_fields?: string[];
  ad_data: Record<string, unknown>;
}

export interface TemplateUpdate {
  name?: string;
  description?: string;
  locked_fields?: string[];
  ad_data?: Record<string, unknown>;
}
