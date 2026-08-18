export interface LoginRequest {
  username: string;
  password: string;
}

export interface Officer {
  id: string;
  username: string;
  role: string;
  fullName?: string;
}

export interface LoginResponse {
  success?: boolean;
  token?: string;
  tempToken?: string;
  role?: string;
  officer?: Officer;
  message?: string;
}

export interface RefreshResponse {
  success: boolean;
  token: string;
}
