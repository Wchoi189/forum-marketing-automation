import React from 'react';
import { Power, Bot, Clock, MessageCircle, AlertTriangle } from 'lucide-react';
import { ChatbotConfig, UnifiedMessage } from '../types';

interface DashboardProps {
  config: ChatbotConfig;
  onUpdateConfig: (config: Partial<ChatbotConfig>) => void;
  recentLogs: UnifiedMessage[];
}

const Dashboard: React.FC<DashboardProps> = ({ config, onUpdateConfig, recentLogs }) => {
  return (
    <div className="p-8 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Agent Control Center</h2>
          <p className="text-gray-500">Manage webhook routing and AI auto-replies.</p>
        </div>
      </div>

      {/* Status Cards / Kill Switches */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className={`p-6 rounded-2xl shadow-sm border ${config.kakaoWebhookEnabled ? 'bg-green-50/50 border-green-200' : 'bg-white border-gray-200'}`}>
          <div className="flex justify-between items-start">
            <div className={`p-3 rounded-xl ${config.kakaoWebhookEnabled ? 'bg-green-100' : 'bg-gray-100'}`}>
              <Power className={`w-6 h-6 ${config.kakaoWebhookEnabled ? 'text-green-600' : 'text-gray-400'}`} />
            </div>
            <button
              onClick={() => onUpdateConfig({ kakaoWebhookEnabled: !config.kakaoWebhookEnabled })}
              className={`px-4 py-2 rounded-full font-bold shadow-sm transition-transform active:scale-95 text-white ${
                config.kakaoWebhookEnabled ? 'bg-green-500 hover:bg-green-600' : 'bg-gray-400 hover:bg-gray-500'
              }`}
            >
              {config.kakaoWebhookEnabled ? 'Disable Webhook' : 'Enable Webhook'}
            </button>
          </div>
          <div className="mt-4">
            <h3 className="text-lg font-bold text-gray-900">Webhook Connection</h3>
            <p className="text-sm text-gray-500 mt-1">
              {config.kakaoWebhookEnabled 
                ? 'Routing Kakao requests to Express backend. Logging is active.' 
                : 'Returning 503 to Kakao payloads. Bot is completely offline.'}
            </p>
          </div>
        </div>

        <div className={`p-6 rounded-2xl shadow-sm border ${config.kakaoAutoreplyEnabled ? 'bg-blue-50/50 border-blue-200' : 'bg-white border-gray-200'}`}>
          <div className="flex justify-between items-start">
            <div className={`p-3 rounded-xl ${config.kakaoAutoreplyEnabled ? 'bg-blue-100' : 'bg-gray-100'}`}>
              <Bot className={`w-6 h-6 ${config.kakaoAutoreplyEnabled ? 'text-blue-600' : 'text-gray-400'}`} />
            </div>
            <button
              onClick={() => onUpdateConfig({ kakaoAutoreplyEnabled: !config.kakaoAutoreplyEnabled })}
              className={`px-4 py-2 rounded-full font-bold shadow-sm transition-transform active:scale-95 text-white ${
                config.kakaoAutoreplyEnabled ? 'bg-blue-500 hover:bg-blue-600' : 'bg-gray-400 hover:bg-gray-500'
              }`}
            >
              {config.kakaoAutoreplyEnabled ? 'Disable Auto-Reply' : 'Enable Auto-Reply'}
            </button>
          </div>
          <div className="mt-4">
            <h3 className="text-lg font-bold text-gray-900">AI Auto-Reply (OpenAI)</h3>
            <p className="text-sm text-gray-500 mt-1">
              {config.kakaoAutoreplyEnabled 
                ? 'Generating LLM responses using Intent classification.' 
                : 'Auto-reply disabled. Webhook will log messages and ACK silently.'}
            </p>
          </div>
        </div>
      </div>

      {/* Warnings / Instructions */}
      {config.kakaoAutoreplyEnabled && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start space-x-3">
          <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-amber-800">Auto-Reply is Active</h4>
            <p className="text-sm text-amber-700 mt-1">
              Ensure you have bound the OpenBuilder skill ONLY to the Dev channel (@mtq2kdq3ndpthyz) to avoid replying to live customers during testing.
            </p>
          </div>
        </div>
      )}

      {/* Mini Log View */}
      <div className="bg-gray-900 rounded-2xl p-6 shadow-lg text-white font-mono text-sm">
        <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
          <span className="text-gray-400">Recent Turn Payload Previews</span>
          <span className="text-xs text-gray-500">Live Webhook Event Stream</span>
        </div>
        <div className="space-y-3 max-h-48 overflow-y-auto">
          {recentLogs.length === 0 ? (
            <div className="text-gray-600 italic">No webhook payloads recorded yet...</div>
          ) : (
            recentLogs.slice(-5).map((log) => (
              <div key={log.id} className="flex space-x-3 text-xs leading-relaxed">
                <span className="text-gray-500 flex-shrink-0">[{new Date(log.ts).toLocaleTimeString()}]</span>
                <span className={
                  log.speaker === 'operator' ? 'text-blue-400 flex-shrink-0 w-16' :
                  log.speaker === 'menu' ? 'text-purple-400 flex-shrink-0 w-16' : 'text-green-400 flex-shrink-0 w-16'
                }>{log.speaker}</span>
                <span className="text-gray-300 break-all">{log.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
