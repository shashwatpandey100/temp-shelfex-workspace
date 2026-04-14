import apiClient from './axios';

export interface User {
  id: string;
  email: string;
  username: string | null;
  name: string | null;
  emailVerified: boolean;
  createdAt: string;
}

export interface LoginResponse {
  success: boolean;
  message: string;
  data: {
    user: {
      id: string;
      email: string;
      name: string | null;
      emailVerified: boolean;
    };
    redirectUrl?: string;
  };
}

export interface RegisterResponse {
  success: boolean;
  message: string;
  data: {
    id: string;
    email: string;
    username: string | null;
    name: string | null;
    emailVerified: boolean;
  };
}

export interface ErrorResponse {
  success: false;
  message: string;
  error?: string;
}

// Auth API
export const authApi = {
  async register(data: {
    email: string;
    username?: string;
    password: string;
    name?: string;
  }): Promise<RegisterResponse> {
    const response = await apiClient.post('/auth/register', data);
    return response.data;
  },

  async login(data: {
    identifier: string;
    password: string;
    client_id?: string;
    redirect_uri?: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    nonce?: string;
  }): Promise<LoginResponse> {
    const response = await apiClient.post('/auth/login', data);
    return response.data;
  },

  async getCurrentUser(): Promise<{ success: boolean; data: User }> {
    const response = await apiClient.get('/auth/me');
    return response.data;
  },

  async logout(): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.post('/auth/logout');
    return response.data;
  },

  async refresh(): Promise<{ success: boolean; data: { accessToken: string } }> {
    const response = await apiClient.post('/auth/refresh');
    return response.data;
  },

  async verifyEmail(data: { email: string; code: string }): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.post('/auth/verify-email', data);
    return response.data;
  },

  async resendVerification(data: { email: string }): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.post('/auth/resend-verification', data);
    return response.data;
  },

  async forgotPassword(data: { email: string }): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.post('/auth/forgot-password', data);
    return response.data;
  },

  async resetPassword(data: { email: string; token: string; newPassword: string }): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.post('/auth/reset-password', data);
    return response.data;
  },
};

// OAuth API
export const oauthApi = {
  async getLoginPageData(params: URLSearchParams): Promise<{
    success: boolean;
    data: {
      client_id: string | null;
      redirect_uri: string | null;
      state: string | null;
    };
  }> {
    const response = await apiClient.get(`/auth/login?${params.toString()}`);
    return response.data;
  },
};
