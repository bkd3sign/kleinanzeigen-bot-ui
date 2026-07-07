export type JobStatus = 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'mfa_required' | 'login_required' | 'waiting_for_user';

export interface Job {
  job_id: string;
  command: string;
  status: JobStatus;
  started_at: string;
  finished_at?: string;
  exit_code?: number;
  output: string;
  last_output_at?: string;
  user_id: string;
  // Display-only: current email resolved from the frozen workspace id.
  // Server-set in API responses; user_id stays the stable internal key.
  user_label?: string;
  workspace: string;
  mfa_required?: boolean;
  // Bot paused at a login/CAPTCHA wall and waits for the user to act in the VNC browser
  // (pause_on_login_detection_failure + PTY). Resumed by writing to stdin. Suspends the watchdog.
  waiting_for_user?: boolean;
  // Force this run into the visible VNC browser (attach + PTY + pause), regardless of the
  // configured mode. Set on the AUTO-mode retry after a login_required job so the user can
  // sign in live; a normal AUTO job stays headless.
  force_visible?: boolean;
  cdp_port?: number;
  queue_position?: number;
  scheduled_by?: string;
  // Delayed profile-lock recovery: how many times this job was auto-re-queued after a browser
  // profile-lock failure, and the ISO time the next automatic attempt is scheduled for (while
  // the job sits in 'queued' waiting out the delay, outside the live queue).
  retry_count?: number;
  retry_at?: string;
}

export interface Schedule {
  id: string;
  name: string;
  command: string;
  cron: string;
  enabled: boolean;
  created_by?: string;
  // Display-only: current email resolved from the frozen creator id.
  // Server-set in API responses; created_by stays the stable internal key.
  created_by_label?: string;
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
