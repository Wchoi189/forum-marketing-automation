import React, { useState } from 'react';
import { Search, Tag, Save, Check, Loader2, Database } from 'lucide-react';
import { UnifiedMessage, TAXONOMY } from '../types';

interface AnnotationToolProps {
  messages: UnifiedMessage[];
  onSaveTags: (messageId: string, tags: string[]) => Promise<void>;
}

const AnnotationTool: React.FC<AnnotationToolProps> = ({ messages, onSaveTags }) => {
  const [selectedMessage, setSelectedMessage] = useState<UnifiedMessage | null>(null);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleSelectMessage = (msg: UnifiedMessage) => {
    setSelectedMessage(msg);
    setActiveTags(msg.labels || []);
  };

  const toggleTag = (tag: string) => {
    if (activeTags.includes(tag)) {
      setActiveTags(activeTags.filter(t => t !== tag));
    } else {
      setActiveTags([...activeTags, tag]);
    }
  };

  const handleSave = async () => {
    if (!selectedMessage) return;
    setIsSaving(true);
    await onSaveTags(selectedMessage.id, activeTags);
    setIsSaving(false);
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 2000);
    
    // Update local state temporarily for UX
    selectedMessage.labels = activeTags;
  };

  return (
    <div className="p-8 h-full flex flex-col">
       <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Annotation Tool</h2>
          <p className="text-gray-500">Label historical / live conversations for AI fine-tuning.</p>
        </div>
        <div className="flex space-x-3">
             <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center space-x-2">
                <Database className="w-4 h-4" />
                <span>conversations.jsonl</span>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 min-h-0">
        {/* Left Column: List */}
        <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center space-x-3 bg-gray-50/50">
                <Search className="w-5 h-5 text-gray-400" />
                <input 
                    type="text" 
                    placeholder="Search messages..." 
                    className="bg-transparent border-none focus:outline-none flex-1 text-sm"
                />
                <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-1 rounded">
                    {messages.length} Items
                </span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-50">
                        <Tag className="w-12 h-12 mb-2" />
                        <span>No messages to label</span>
                    </div>
                ) : (
                    messages.map((msg) => (
                        <div 
                           key={msg.id} 
                           onClick={() => handleSelectMessage(msg)}
                           className={`cursor-pointer group flex flex-col p-3 rounded-xl transition-colors border ${
                             selectedMessage?.id === msg.id 
                                ? 'bg-blue-50 border-blue-200' 
                                : 'border-transparent hover:bg-gray-50 hover:border-gray-100'
                           }`}
                        >
                            <div className="flex items-center justify-between mb-1">
                                <span className={`text-xs font-bold ${msg.speaker === 'customer' ? 'text-green-600' : 'text-blue-600'}`}>
                                    {msg.speaker === 'customer' ? msg.user_id : 'Operator'}
                                </span>
                                <span className="text-[10px] text-gray-400">{new Date(msg.ts).toLocaleDateString()}</span>
                            </div>
                            <p className="text-sm text-gray-700 line-clamp-2">{msg.text}</p>
                            {msg.labels && msg.labels.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                    {msg.labels.map(l => (
                                        <span key={l} className="px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded text-[10px]">{l}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>

        {/* Right Column: Labeller */}
        <div className="lg:col-span-2 space-y-4 flex flex-col">
            {selectedMessage ? (
               <>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex-1">
                    <div className="mb-6">
                        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Message Content</h3>
                        <div className={`p-4 rounded-xl ${selectedMessage.speaker === 'customer' ? 'bg-green-50' : 'bg-blue-50'}`}>
                             <p className="text-gray-800 whitespace-pre-wrap">{selectedMessage.text}</p>
                        </div>
                    </div>
                    
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">Intents</h3>
                            <div className="flex flex-wrap gap-2">
                                {TAXONOMY.intents.map(intent => (
                                    <button 
                                        key={intent}
                                        onClick={() => toggleTag(`intent:${intent}`)}
                                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                                            activeTags.includes(`intent:${intent}`) 
                                                ? 'bg-purple-100 text-purple-700 border border-purple-200' 
                                                : 'bg-gray-100 text-gray-600 border border-transparent hover:bg-gray-200'
                                        }`}
                                    >
                                        {intent}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">Topics</h3>
                            <div className="flex flex-wrap gap-2">
                                {TAXONOMY.topics.map(topic => (
                                    <button 
                                        key={topic}
                                        onClick={() => toggleTag(`topic:${topic}`)}
                                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                                            activeTags.includes(`topic:${topic}`) 
                                                ? 'bg-blue-100 text-blue-700 border border-blue-200' 
                                                : 'bg-gray-100 text-gray-600 border border-transparent hover:bg-gray-200'
                                        }`}
                                    >
                                        {topic}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end">
                    <button 
                        onClick={handleSave}
                        disabled={isSaving}
                        className={`flex items-center space-x-2 px-6 py-3 rounded-xl shadow-lg transition-colors font-medium ${
                            showSuccess 
                            ? 'bg-green-600 text-white' 
                            : 'bg-gray-900 text-white hover:bg-gray-800'
                        }`}
                    >
                        {isSaving ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : showSuccess ? (
                            <Check className="w-5 h-5" />
                        ) : (
                            <Save className="w-5 h-5" />
                        )}
                        <span>{showSuccess ? 'Saved Labels' : 'Save Annotations'}</span>
                    </button>
                </div>
               </>
            ) : (
                <div className="flex-1 bg-white rounded-2xl border border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400">
                    <Tag className="w-16 h-16 mb-4 text-gray-300" />
                    <p className="font-medium text-gray-500">Select a message from the left to start annotating</p>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default AnnotationTool;
