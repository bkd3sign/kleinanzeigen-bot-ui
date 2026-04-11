export type JobStatus = 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'mfa_required';

export interface Job {
  job_id: string;
  command: string;
  status: JobStatus;
  started_at: string;
  finished_at?: string;
  exit_code?: number;
  output: string;
  user_id: string;
  workspace: string;
  mfa_required?: boolean;
  queue_position?: number;
  scheduled_by?: string;
}

export interface Schedule {
  id: string;
  name: string;
  command: string;
  cron: string;
  enabled: boolean;
  created_by?: string;
  forked_from?: string;
  last_run?: string;
  last_status?: JobStatus;
  next_run?: string;
}

export interface PublishOptions {
  ads?: string;
  force?: boolean;
  keep_old?: boolean;
  verbose?: boolean;
}

export interface DownloadOptions {
  ads?: string;
  verbose?: boolean;
}

export interface UpdateOptions {
  ads?: string;
  verbose?: boolean;
}

export interface ExtendOptions {
  ads?: string;
  verbose?: boolean;
}

export interface DeleteOptions {
  ads?: string;
  verbose?: boolean;
}

export interface SetupData {
  username: string;
  password: string;
  contact_name?: string;
  contact_zipcode?: string;
  contact_location?: string;
  email: string;
  web_password: string;
  display_name?: string;
  openrouter_api_key?: string;
}

export interface ConfigUpdate {
  ad_defaults?: Record<string, unknown>;
  publishing?: Record<string, unknown>;
  timeouts?: Record<string, unknown>;
  download?: Record<string, unknown>;
  update_check?: Record<string, unknown>;
  login?: Record<string, unknown>;
}
