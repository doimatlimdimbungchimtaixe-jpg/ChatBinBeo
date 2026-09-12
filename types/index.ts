export type Role = "user" | "assistant" | "system";

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface GenerationOptions {
  maxTokens?: number;
  temperature?: number;
  topK?: number;
  topP?: number;
  /** called with partial decoded text */
  onToken?: (partial: string) => void;
  signal?: AbortSignal;
}

export type ThemeMode = "light" | "dark" | "system";

export interface AppSettings {
  theme: ThemeMode;
  temperature: number;
  maxTokens: number;
}
