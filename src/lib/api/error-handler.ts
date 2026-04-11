import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/security/validation';

/**
 * Convert caught errors to proper HTTP responses.
 * ApiError instances (statusCode property) get their status code, others get 500.
 */
export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ detail: error.message }, { status: error.statusCode });
  }
  const message = error instanceof Error ? error.message : 'Internal server error';
  return NextResponse.json({ detail: message }, { status: 500 });
}
