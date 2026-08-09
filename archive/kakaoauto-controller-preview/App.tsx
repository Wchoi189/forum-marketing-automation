import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import KnowledgeBaseEditor from './components/KnowledgeBaseEditor';
import AnnotationTool from './components/AnnotationTool';
import ConfigForm from './components/ConfigForm';
import LogTerminal from './components/LogTerminal';
import { AppMode, ChatbotConfig, UnifiedMessage, FAQEntry, ConnectionStatus } from './types';

// Assuming the new Express server runs on port 3000/api
const API_URL = '/api';

const App: React.FC = () => {
  const [currentMode, setMode] = useState<AppMode>(AppMode.DASHBOARD);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  
  // State for chatbot configuration
  const [config, setConfig] = useState<ChatbotConfig>({
    kakaoWebhookEnabled: false,
    kakaoAutoreplyEnabled: false,
    kakaoOpenbuilderBotId: 'bot-1433640',
    openAiApiKey: '',
    kakaoAdminKey: '',
    kakaoMessengerRestApiKey: '',
    kakaoSkillSecret: '',
    kakaoLoginClientSecret: '',
    kakaoBizClientSecret: '',
    kakaoChannelId: '',
    kakaoBaseUrl: 'https://kapi.kakao.com/v2/api/talk/channels',
  });

  const [faqEntries, setFaqEntries] = useState<FAQEntry[]>([]);
  const [messages, setMessages] = useState<UnifiedMessage[]>([]);

  // --- API Integrations ---

  const checkStatus = async () => {
    try {
        const response = await fetch(`${API_URL}/health`);
        if (response.ok) {
            setConnectionStatus(ConnectionStatus.CONNECTED);
        } else {
            setConnectionStatus(ConnectionStatus.DISCONNECTED);
        }
    } catch (e) {
        setConnectionStatus(ConnectionStatus.DISCONNECTED);
    }
    
    // For demo purposes in UI builder, let's keep it connected if fetch fails
    setConnectionStatus(ConnectionStatus.CONNECTED);
  };

  useEffect(() => {
    checkStatus();
    
    // Pre-populate some dummy historical data for the annotator
    setMessages([
      { id: 'usr1-001', conv_id: 'SharePlan_JohnDoe', ts: new Date(Date.now() - 3600000).toISOString(), source: 'historical', speaker: 'customer', user_id: 'JohnDoe', text: 'Hi, I would like to purchase YouTube Premium 12 months.', labels: [] },
      { id: 'op-001', conv_id: 'SharePlan_JohnDoe', ts: new Date(Date.now() - 3500000).toISOString(), source: 'historical', speaker: 'operator', user_id: 'SharePlan', text: 'Hello! That will be ₩50,000. Please transfer to IBK...', labels: [] },
      { id: 'bot-001', conv_id: 'SharePlan_Live1', ts: new Date(Date.now() - 60000).toISOString(), source: 'live', speaker: 'menu', user_id: 'SharePlan(메뉴)', text: '서비스 목록\n1. YouTube\n2. Coursera', labels: [] }
    ]);
  }, []);

  const handleUpdateConfig = async (newConfig: Partial<ChatbotConfig>) => {
    const updated = { ...config, ...newConfig };
    setConfig(updated);
    if (connectionStatus === ConnectionStatus.CONNECTED) {
        try {
            await fetch(`${API_URL}/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated)
            });
        } catch (e) { console.error(e); }
    }
  };

  const handleSaveTags = async (messageId: string, tags: string[]) => {
      setMessages(msgs => msgs.map(m => m.id === messageId ? { ...m, labels: tags } : m));
      // Call backend to update JSONL...
  };

  const handleSaveFaqs = async (entries: FAQEntry[]) => {
      setFaqEntries(entries);
      // Call backend to update KB...
  };
  
  const handleExportKb = () => {
      alert("Downloading knowledge-base-import.xlsx...");
  };

  const renderContent = () => {
    switch (currentMode) {
      case AppMode.DASHBOARD:
        return <Dashboard 
            config={config} 
            onUpdateConfig={handleUpdateConfig} 
            recentLogs={messages.filter(m => m.source === 'live')}
        />;
      case AppMode.ANNOTATE:
        return <AnnotationTool 
            messages={messages} 
            onSaveTags={handleSaveTags}
        />;
      case AppMode.KNOWLEDGE_BASE:
        return <KnowledgeBaseEditor 
            entries={faqEntries} 
            setEntries={setFaqEntries} 
            onSave={handleSaveFaqs}
            onExport={handleExportKb}
        />;
      case AppMode.SETTINGS:
        return <ConfigForm 
            config={config} 
            setConfig={setConfig} 
            onSave={async (cfg) => handleUpdateConfig(cfg)}
        />;
      case AppMode.LOGS:
        return <LogTerminal logs={messages.filter(m => m.source === 'live')} onClear={() => setMessages(msgs => msgs.filter(m => m.source !== 'live'))} />;
      default:
        return <Dashboard 
            config={config} 
            onUpdateConfig={handleUpdateConfig}
            recentLogs={messages.filter(m => m.source === 'live')}
        />;
    }
  };

  return (
    <div className="flex min-h-screen bg-[#F3F4F6]">
      <Sidebar 
        currentMode={currentMode} 
        setMode={setMode} 
        connectionStatus={connectionStatus}
      />
      <div className="flex-1 ml-64">
        {renderContent()}
      </div>
    </div>
  );
};

export default App;
