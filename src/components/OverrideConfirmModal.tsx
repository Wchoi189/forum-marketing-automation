import { motion, AnimatePresence } from 'motion/react';
import { ShieldAlert, Send } from 'lucide-react';

interface OverrideConfirmModalProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export default function OverrideConfirmModal({ onConfirm, onCancel }: OverrideConfirmModalProps) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      >
        <motion.div
          initial={{ scale: 0.95, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 20 }}
          className="bg-[#111] border border-white/10 rounded-3xl p-8 max-w-sm w-full shadow-2xl space-y-6"
        >
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-500/20 text-red-500 flex items-center justify-center">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold tracking-tight text-white">Unsafe to Publish</h3>
            <p className="text-sm opacity-60 leading-relaxed">
              The gap threshold policy indicates the board is too slow right now. Scheduled rules will skip execution and prevent publishing.
            </p>
            <div className="w-full h-[1px] bg-white/10" />
            <p className="text-sm opacity-60 font-semibold text-orange-400">
              If you really want to force a post out, use the Manual Override action.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 py-3 rounded-xl bg-orange-600 hover:bg-orange-500 shadow-lg shadow-orange-600/20 text-white font-bold text-sm transition-all flex items-center gap-2 justify-center"
            >
              <Send className="w-4 h-4" />
              Force Override
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
