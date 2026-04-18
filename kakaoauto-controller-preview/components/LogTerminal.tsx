import React, { useEffect, useRef } from 'react';
import { UnifiedMessage } from '../types';
import { Trash2, Download } from 'lucide-react';

interface LogTerminalProps {
  logs: UnifiedMessage[];
  onClear: () => void;
}

const LogTerminal: React.FC<LogTerminalProps> = ({ logs, onClear }) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="p-8 h-full flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Live JSONL Logs</h2>
          <p className="text-gray-500">Real-time trace of webhook events and LLM outputs.</p>
        </div>
        <div className="flex space-x-2">
            <button 
                onClick={onClear}
                className="p-2 text-red-500 hover:text-red-700 bg-white border border-gray-200 rounded-lg shadow-sm"
            >
                <Trash2 className="w-4 h-4" />
            </button>
            <button className="flex items-center space-x-2 px-3 py-2 text-gray-700 hover:text-gray-900 bg-white border border-gray-200 rounded-lg shadow-sm text-sm font-medium">
                <Download className="w-4 h-4" />
                <span>Export /artifacts</span>
            </button>
        </div>
      </div>

      <div className="flex-1 bg-[#1E1E1E] rounded-xl shadow-inner border border-gray-700 overflow-hidden flex flex-col font-mono text-sm leading-relaxed tracking-tight">
        <div className="bg-[#2D2D2D] px-4 py-2 flex items-center space-x-2 border-b border-gray-700">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <span className="ml-2 text-gray-400 text-xs">stdout • kakao-history</span>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
            {logs.map((log) => (
                <div key={log.id} className="flex hover:bg-[#2D2D2D] -mx-4 px-4 py-1">
                    <span className="text-gray-500 w-32 flex-shrink-0 select-none">[{new Date(log.ts).toLocaleString()}]</span>
                    <span className={`w-24 flex-shrink-0 font-bold ${
                        log.speaker === 'operator' ? 'text-blue-400' :
                        log.speaker === 'menu' ? 'text-purple-400' : 'text-green-400'
                    }`}>{log.speaker.toUpperCase()}</span>
                    <div className="flex flex-col space-y-1 flex-1">
                         <span className="text-gray-300 whitespace-pre-wrap break-all">{log.text}</span>
                         {log.labels && log.labels.length > 0 && (
                            <div className="flex gap-1.5">
                               {log.labels.map(l => (
                                   <span key={l} className="text-[10px] bg-gray-700 text-gray-300 px-1 py-0.5 rounded">{l}</span>
                               ))}
                            </div>
                         )}
                    </div>
                </div>
            ))}
            <div ref={endRef} />
        </div>
      </div>
    </div>
  );
};

export default LogTerminal;
