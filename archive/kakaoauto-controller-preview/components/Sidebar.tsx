import React from 'react';
import { LayoutDashboard, BookOpen, Tags, Settings, Terminal, Zap, Wifi, WifiOff, MessageCircle } from 'lucide-react';
import { AppMode, ConnectionStatus } from '../types';

interface SidebarProps {
  currentMode: AppMode;
  setMode: (mode: AppMode) => void;
  connectionStatus: ConnectionStatus;
}

const Sidebar: React.FC<SidebarProps> = ({ currentMode, setMode, connectionStatus }) => {
  const navItems = [
    { mode: AppMode.DASHBOARD, icon: LayoutDashboard, label: 'Control Center' },
    { mode: AppMode.ANNOTATE, icon: Tags, label: 'Annotation Tool' },
    { mode: AppMode.KNOWLEDGE_BASE, icon: BookOpen, label: 'Knowledge Base' },
    { mode: AppMode.SETTINGS, icon: Settings, label: 'Configuration' },
    { mode: AppMode.LOGS, icon: Terminal, label: 'Live Logs' },
  ];

  return (
    <div className="w-64 bg-white h-screen border-r border-gray-200 flex flex-col fixed left-0 top-0 z-10">
      <div className="p-6 flex items-center space-x-3 border-b border-gray-100">
        <div className="bg-kakao-yellow p-2 rounded-lg text-kakao-brown">
          <MessageCircle className="w-6 h-6" />
        </div>
        <div>
          <h1 className="font-bold text-lg text-gray-800">KakaoBot</h1>
          <p className="text-xs text-gray-500">SharePlan Agent</p>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => (
          <button
            key={item.mode}
            onClick={() => setMode(item.mode)}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 ${
              currentMode === item.mode
                ? 'bg-kakao-yellow text-kakao-brown font-semibold shadow-sm'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <item.icon className={`w-5 h-5 ${currentMode === item.mode ? 'text-kakao-brown' : 'text-gray-400'}`} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-100">
        {/* Connection Status Widget */}
        <div className={`rounded-xl p-4 mb-3 border ${
          connectionStatus === ConnectionStatus.CONNECTED ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-center justify-between">
             <div className="flex items-center space-x-2">
                {connectionStatus === ConnectionStatus.CONNECTED ? (
                    <Wifi className="w-4 h-4 text-green-600" />
                ) : (
                    <WifiOff className="w-4 h-4 text-red-600" />
                )}
                <span className={`text-xs font-bold ${
                     connectionStatus === ConnectionStatus.CONNECTED ? 'text-green-700' : 'text-red-700'
                }`}>
                    {connectionStatus === ConnectionStatus.CONNECTED ? 'Webhook Online' : 'Webhook Offline'}
                </span>
             </div>
             <div className={`w-2 h-2 rounded-full ${
                 connectionStatus === ConnectionStatus.CONNECTED ? 'bg-green-500 animate-pulse' : 'bg-red-500'
             }`}></div>
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs text-gray-400">v3.0 (AI Agent)</p>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
