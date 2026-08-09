export enum AppMode {
  DASHBOARD = 'DASHBOARD',
  ANNOTATE = 'ANNOTATE',
  KNOWLEDGE_BASE = 'KNOWLEDGE_BASE',
  SETTINGS = 'SETTINGS',
  LOGS = 'LOGS'
}

export enum ConnectionStatus {
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING'
}

export interface ChatbotConfig {
  kakaoWebhookEnabled: boolean;
  kakaoAutoreplyEnabled: boolean;
  kakaoOpenbuilderBotId: string;
  openAiApiKey: string;
  kakaoAdminKey: string;
  kakaoMessengerRestApiKey: string;
  kakaoSkillSecret: string;
  kakaoLoginClientSecret: string;
  kakaoBizClientSecret: string;
  kakaoChannelId: string;
  kakaoBaseUrl: string;
}

export interface UnifiedMessage {
  id: string;
  conv_id: string;
  ts: string;
  source: 'live' | 'historical';
  speaker: 'operator' | 'menu' | 'customer';
  user_id: string;
  text: string;
  labels: string[];
  meta?: {
    block_id?: string;
    block_name?: string;
    intent_id?: string;
    bot_id?: string;
    conv_filename?: string;
  };
}

export const TAXONOMY = {
  intents: ["inquiry_price", "inquiry_service", "inquiry_process", "provide_email", "confirm_payment", "request_as", "renewal", "cancel", "complaint", "greeting", "other"],
  topics: ["youtube_premium", "coursera", "pricing", "payment", "google_family", "activation", "as_support", "renewal", "general"],
  sentiment: ["positive", "neutral", "negative"]
};

export interface FAQEntry {
  id: string;
  faqNo: string;
  category1: string;
  category2: string;
  question: string;
  answer: string;
}
