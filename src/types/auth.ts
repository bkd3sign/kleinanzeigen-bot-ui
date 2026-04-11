export interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
  display_name: string;
}

export interface UserWithPassword extends User {
  password_hash: string;
  token_version?: number;
  created_at: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  display_name?: string;
  invite_token: string;
}

export interface ProfileUpdate {
  display_name?: string;
  password?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Invite {
  token_hash: string;
  created_by: string;
  created_at: string;
  expires_at: string;
}

export interface UsersData {
  jwt_secret?: string;
  users: UserWithPassword[];
  invites: Invite[];
}
