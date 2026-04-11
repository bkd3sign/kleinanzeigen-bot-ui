import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { AuthResponse, LoginRequest, RegisterRequest, ProfileUpdate } from '@/types/auth';

export function useLogin() {
  return useMutation({
    mutationFn: (data: LoginRequest) =>
      api.post<AuthResponse>('/api/auth/login', data),
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (data: RegisterRequest) =>
      api.post<AuthResponse>('/api/auth/register', data),
  });
}

export function useUpdateProfile() {
  return useMutation({
    mutationFn: (data: ProfileUpdate) =>
      api.put<{ status: string }>('/api/auth/me', data),
  });
}
