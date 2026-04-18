import React, { useState } from 'react';
import { Save, Plus, Trash2, Check, Loader2, Download } from 'lucide-react';
import { FAQEntry } from '../types';

interface KBEditorProps {
  entries: FAQEntry[];
  setEntries: (entries: FAQEntry[]) => void;
  onSave: (entries: FAQEntry[]) => Promise<void>;
  onExport: () => void;
}

const KnowledgeBaseEditor: React.FC<KBEditorProps> = ({ entries, setEntries, onSave, onExport }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    await onSave(entries);
    setIsSaving(false);
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 2000);
  };

  const handleAdd = () => {
    setEntries([
        ...entries, 
        { id: Date.now().toString(), faqNo: (entries.length + 1).toString(), category1: 'Support', category2: '', question: '', answer: '' }
    ]);
  };

  const handleDelete = (id: string) => {
    setEntries(entries.filter(e => e.id !== id));
  };

  const updateEntry = (id: string, field: keyof FAQEntry, value: string) => {
    setEntries(entries.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  return (
    <div className="p-8 h-full flex flex-col">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Knowledge Base Editor</h2>
          <p className="text-gray-500">Manage FAQs for Kakao OpenBuilder upload.</p>
        </div>
        <div className="flex space-x-3">
             <button 
                onClick={onExport}
                className="flex items-center space-x-2 px-4 py-2 border rounded-lg transition-all duration-200 bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              <Download className="w-4 h-4" />
              <span>Export XLSX</span>
            </button>
            <button 
                onClick={handleSave}
                disabled={isSaving}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 font-medium ${
                    showSuccess 
                    ? 'bg-green-100 text-green-700' 
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
              <span>{showSuccess ? 'Saved!' : 'Save Progress'}</span>
            </button>
        </div>
      </div>

      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col overflow-hidden">
         <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
           <span className="font-semibold text-gray-700">{entries.length} FAQ Entries</span>
           <button 
               onClick={handleAdd}
               className="flex items-center space-x-1 px-3 py-1.5 bg-gray-900 text-white rounded text-sm hover:bg-gray-800"
            >
               <Plus className="w-4 h-4" />
               <span>New Entry</span>
           </button>
         </div>

         <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
             {entries.length === 0 ? (
                 <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-50">
                     <span>No entries yet. Create one to get started.</span>
                 </div>
             ) : (
                 entries.map((entry) => (
                     <div key={entry.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm relative group">
                        <button 
                            onClick={() => handleDelete(entry.id)}
                            className="absolute top-4 right-4 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                             <Trash2 className="w-4 h-4" />
                        </button>
                        
                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Category 1</label>
                                <input 
                                    className="w-full text-sm p-2 border border-gray-200 rounded focus:border-blue-500 focus:outline-none"
                                    value={entry.category1}
                                    onChange={(e) => updateEntry(entry.id, 'category1', e.target.value)}
                                    placeholder="e.g., Support"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Category 2</label>
                                <input 
                                    className="w-full text-sm p-2 border border-gray-200 rounded focus:border-blue-500 focus:outline-none"
                                    value={entry.category2}
                                    onChange={(e) => updateEntry(entry.id, 'category2', e.target.value)}
                                    placeholder="e.g., YouTube Premium"
                                />
                            </div>
                        </div>
                        <div className="mb-4">
                             <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Question (Variations separated by commas)</label>
                             <input 
                                 className="w-full text-sm p-2 border border-gray-200 rounded focus:border-blue-500 focus:outline-none font-medium text-gray-800"
                                 value={entry.question}
                                 onChange={(e) => updateEntry(entry.id, 'question', e.target.value)}
                                 placeholder="How do I get an invite?"
                             />
                        </div>
                         <div>
                             <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Answer</label>
                             <textarea 
                                 rows={3}
                                 className="w-full text-sm p-2 border border-gray-200 rounded focus:border-blue-500 focus:outline-none resize-none text-gray-700"
                                 value={entry.answer}
                                 onChange={(e) => updateEntry(entry.id, 'answer', e.target.value)}
                                 placeholder="You will receive an invite link via email..."
                             />
                        </div>
                     </div>
                 ))
             )}
         </div>
      </div>
    </div>
  );
};

export default KnowledgeBaseEditor;
