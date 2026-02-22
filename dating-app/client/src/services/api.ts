const API_BASE = '/api';

class ApiService {
  private token: string | null = null;

  constructor() {
    this.token = localStorage.getItem('spark_token');
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('spark_token', token);
    } else {
      localStorage.removeItem('spark_token');
    }
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    // Only set Content-Type for non-FormData requests
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Auth
  async register(data: {
    email: string;
    password: string;
    displayName: string;
    age: number;
    gender: string;
  }) {
    return this.request<any>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async login(email: string, password: string) {
    return this.request<any>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async getMe() {
    return this.request<any>('/auth/me');
  }

  // Profile
  async updateProfile(data: Record<string, any>) {
    return this.request<any>('/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async updatePreferences(data: Record<string, any>) {
    return this.request<any>('/profile/preferences', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async uploadPhoto(file: File) {
    const formData = new FormData();
    formData.append('photo', file);
    return this.request<any>('/profile/photos', {
      method: 'POST',
      body: formData,
    });
  }

  async deletePhoto(photoId: string) {
    return this.request<any>(`/profile/photos/${photoId}`, {
      method: 'DELETE',
    });
  }

  async setPrimaryPhoto(photoId: string) {
    return this.request<any>(`/profile/photos/${photoId}/primary`, {
      method: 'PUT',
    });
  }

  async getInterests() {
    return this.request<any>('/profile/interests');
  }

  // Discovery
  async getDiscovery(limit = 20, offset = 0) {
    return this.request<any>(`/discover?limit=${limit}&offset=${offset}`);
  }

  async swipe(targetUserId: string, direction: 'like' | 'pass' | 'superlike') {
    return this.request<any>('/discover/swipe', {
      method: 'POST',
      body: JSON.stringify({ targetUserId, direction }),
    });
  }

  // Matches
  async getMatches() {
    return this.request<any>('/matches');
  }

  async unmatch(matchId: string) {
    return this.request<any>(`/matches/${matchId}`, {
      method: 'DELETE',
    });
  }

  // Messages
  async getMessages(matchId: string, limit = 50, before?: string) {
    let url = `/messages/${matchId}?limit=${limit}`;
    if (before) url += `&before=${before}`;
    return this.request<any>(url);
  }

  async sendMessage(matchId: string, content: string, type = 'text') {
    return this.request<any>(`/messages/${matchId}`, {
      method: 'POST',
      body: JSON.stringify({ content, type }),
    });
  }

  // Safety
  async blockUser(blockedUserId: string) {
    return this.request<any>('/safety/block', {
      method: 'POST',
      body: JSON.stringify({ blockedUserId }),
    });
  }

  async unblockUser(userId: string) {
    return this.request<any>(`/safety/block/${userId}`, {
      method: 'DELETE',
    });
  }

  async getBlockedUsers() {
    return this.request<any>('/safety/blocked');
  }

  async reportUser(reportedUserId: string, reason: string, description?: string) {
    return this.request<any>('/safety/report', {
      method: 'POST',
      body: JSON.stringify({ reportedUserId, reason, description }),
    });
  }

  async getNotifications(limit = 20) {
    return this.request<any>(`/safety/notifications?limit=${limit}`);
  }

  async markNotificationsRead() {
    return this.request<any>('/safety/notifications/read', {
      method: 'PUT',
    });
  }

  async deactivateAccount() {
    return this.request<any>('/safety/account', {
      method: 'DELETE',
    });
  }
}

export const api = new ApiService();
