export interface User {
  id: string;
  email: string;
  displayName: string;
  age: number;
  gender: string;
  bio: string;
  locationCity: string;
  locationState: string;
  occupation: string;
  education: string;
  heightCm: number | null;
  lookingFor: string;
  photos: Photo[];
  interests: Interest[];
  isPremium: boolean;
  profileComplete: boolean;
  createdAt: string;
}

export interface Photo {
  id: string;
  url: string;
  isPrimary?: boolean;
  is_primary?: number;
  sortOrder?: number;
  sort_order?: number;
}

export interface Interest {
  id: string;
  name: string;
  category: string;
}

export interface Preferences {
  minAge: number;
  maxAge: number;
  preferredGender: string;
  maxDistanceKm: number;
  lookingFor: string;
}

export interface DiscoveryProfile {
  id: string;
  displayName: string;
  age: number;
  gender: string;
  bio: string;
  locationCity: string;
  locationState: string;
  occupation: string;
  education: string;
  heightCm: number | null;
  lookingFor: string;
  photos: Photo[];
  interests: Interest[];
  sharedInterests: Interest[];
  compatibilityScore: number;
  lastActive: string;
}

export interface Match {
  matchId: string;
  matchedAt: string;
  user: {
    id: string;
    displayName: string;
    age: number;
    gender: string;
    bio: string;
    locationCity: string;
    occupation: string;
    photoUrl: string | null;
    lastActive: string;
  };
  lastMessage: {
    content: string;
    isOwn: boolean;
    createdAt: string;
    isRead: boolean;
  } | null;
  unreadCount: number;
}

export interface Message {
  id: string;
  matchId?: string;
  senderId: string;
  content: string;
  type: string;
  isRead: boolean;
  isOwn: boolean;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  referenceId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    age: number;
    gender: string;
    bio?: string;
    profileComplete: boolean;
  };
}
