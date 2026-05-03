import { LoginResponse } from '../types/auth';

// TODO: replace stub with real auth endpoint when backend is ready
export async function login(email: string): Promise<LoginResponse> {
  return { userId: email, email };
}
