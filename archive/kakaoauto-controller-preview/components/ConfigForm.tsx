import React, { useState } from 'react';
import { ChatbotConfig } from '../types';
import { Settings, Save, Loader2, Check, KeySquare, Bot } from 'lucide-react';

interface ConfigFormProps {
  config: ChatbotConfig;
  setConfig: (config: ChatbotConfig) => void;
  onSave: (config: ChatbotConfig) => Promise<void>;
}

const ConfigForm: React.FC<ConfigFormProps> = ({ config, setConfig, onSave }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  
  const handleChange = (key: keyof ChatbotConfig, value: any) => {
    setConfig({ ...config, [key]: value });
  };

  const handleSave = async () => {
    setIsSaving(true);
    await onSave(config);
    setIsSaving(false);
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 2000);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Configuration</h2>
          <p className="text-gray-500">System settings and environment variables.</p>
        </div>
        <button 
            onClick={handleSave}
            disabled={isSaving}
            className={`flex items-center space-x-2 px-6 py-3 rounded-xl shadow-lg transition-colors font-medium ${
                 showSuccess 
                 ? 'bg-green-600 text-white' 
                 : 'bg-kakao-brown text-white hover:bg-gray-800'
            }`}
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : showSuccess ? (
            <Check className="w-4 h-4" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          <span>{showSuccess ? 'Saved' : 'Save Changes'}</span>
        </button>
      </div>

      <div className="space-y-6">
        {/* Core Settings */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Bot className="w-5 h-5 mr-2 text-gray-400" />
                KakaoOpenBuilder Settings
            </h3>
            
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">KAKAO_OPENBUILDER_BOT_ID</label>
                    <input 
                        type="text" 
                        value={config.kakaoOpenbuilderBotId}
                        onChange={(e) => handleChange('kakaoOpenbuilderBotId', e.target.value)}
                        placeholder="e.g., 613c70de1b9f4e... "
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-400">Used for validating inbound webhook payloads to prevent spoofing.</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">KAKAO_ADMIN_KEY</label>
                    <input 
                        type="password" 
                        value={config.kakaoAdminKey}
                        onChange={(e) => handleChange('kakaoAdminKey', e.target.value)}
                        placeholder="••••••••••••••••••••••••"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-400">Required if doing outbound channel API calls (Phase 5).</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">KAKAO_MESSENGER_REST_API_KEY</label>
                    <input 
                        type="password" 
                        value={config.kakaoMessengerRestApiKey || ''}
                        onChange={(e) => handleChange('kakaoMessengerRestApiKey', e.target.value)}
                        placeholder="••••••••••••••••••••••••"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-400">REST API Key for App 1377955 to use BizMessage (AlimTalk), Phase 5+.</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">KAKAO_SKILL_SECRET</label>
                    <input 
                        type="password" 
                        value={config.kakaoSkillSecret || ''}
                        onChange={(e) => handleChange('kakaoSkillSecret', e.target.value)}
                        placeholder="••••••••••••••••••••••••"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-400">Used for HMAC signature verification of inbound skill requests.</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">KAKAO_LOGIN_CLIENT_SECRET</label>
                    <input 
                        type="password" 
                        value={config.kakaoLoginClientSecret || ''}
                        onChange={(e) => handleChange('kakaoLoginClientSecret', e.target.value)}
                        placeholder="••••••••••••••••••••••••"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-400">Kakao Login client secret (App 1377955).</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">KAKAO_BIZ_CLIENT_SECRET</label>
                    <input 
                        type="password" 
                        value={config.kakaoBizClientSecret || ''}
                        onChange={(e) => handleChange('kakaoBizClientSecret', e.target.value)}
                        placeholder="••••••••••••••••••••••••"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-400">Biz authentication secret used for AlimTalk sender token exchange (App 1377955).</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">KAKAO_CHANNEL_ID</label>
                    <input 
                        type="text" 
                        value={config.kakaoChannelId || ''}
                        onChange={(e) => handleChange('kakaoChannelId', e.target.value)}
                        placeholder="e.g., @shareplan"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-400">Channel identifier (plusFriendId) for API calls.</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">KAKAO_BASE_URL</label>
                    <input 
                        type="text" 
                        value={config.kakaoBaseUrl || ''}
                        onChange={(e) => handleChange('kakaoBaseUrl', e.target.value)}
                        placeholder="https://kapi.kakao.com/v2/api/talk/channels"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-400">Base URL for Kakao Talk Channels API.</p>
                </div>
            </div>
        </div>

        {/* AI Key Settings */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <KeySquare className="w-5 h-5 mr-2 text-gray-400" />
                AI Provider Settings
            </h3>
            <div className="space-y-4">
                 <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">OPENAI_API_KEY</label>
                    <input 
                        type="password" 
                        value={config.openAiApiKey}
                        onChange={(e) => handleChange('openAiApiKey', e.target.value)}
                        placeholder="sk-..."
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-400">Used for intent classification and auto-reply generation.</p>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigForm;
