import React, { useMemo } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  Position,
  Handle,
  MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion } from 'motion/react';
import { Compass, LogIn, UserCircle, PenTool, History, Upload } from 'lucide-react';

export type PipelineStepId = 'navigate' | 'login-page' | 'login' | 'write-post' | 'restore-draft' | 'publish' | 'standby' | 'complete';

export interface PipelineCanvasProps {
  currentStep: PipelineStepId;
}

const STAGES = [
  { id: 'navigate', label: 'NAVIGATE', icon: Compass },
  { id: 'login-page', label: 'LOGIN PAGE', icon: LogIn },
  { id: 'login', label: 'LOGIN', icon: UserCircle },
  { id: 'write-post', label: 'WRITE POST', icon: PenTool },
  { id: 'restore-draft', label: 'RESTORE', icon: History },
  { id: 'publish', label: 'PUBLISH', icon: Upload }
];

const CustomNode = ({ data }: { data: any }) => {
  const isComplete = data.status === 'complete';
  const isActive = data.status === 'active';
  const Icon = data.icon;

  return (
    <div className="flex flex-col items-center justify-center gap-3 w-28">
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-[#2a2a2a] !border-white/10 !-ml-2" />
      
      {/* Icon Box */}
      <motion.div
        className={`w-16 h-16 rounded-xl flex items-center justify-center border-2 transition-colors duration-300 relative z-10 ${
          isComplete ? 'bg-[#2a2a2a] border-white/20 text-white/50' :
          isActive ? 'bg-[#2a2a2a] border-orange-500 text-orange-400 z-20' :
          'bg-[#1a1a1a] border-white/5 text-white/20'
        }`}
        animate={isActive ? {
          boxShadow: ['0 0 0px rgba(249,115,22,0)', '0 0 20px rgba(249,115,22,0.4)', '0 0 0px rgba(249,115,22,0)'],
          borderColor: ['rgba(249,115,22,0.5)', 'rgba(249,115,22,1)', 'rgba(249,115,22,0.5)']
        } : {}}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Icon strokeWidth={isActive ? 2.5 : 2} className={isActive ? 'w-8 h-8' : 'w-6 h-6'} />
      </motion.div>

      {/* Label Pill */}
      <div
        className={`px-3 py-1.5 rounded-full border text-[9px] font-bold tracking-wider transition-colors duration-300 whitespace-nowrap min-w-[90px] text-center ${
          isComplete ? 'bg-[#2a2a2a] border-white/20 text-white/60' :
          isActive ? 'bg-[#2a2a2a] border-orange-500 text-orange-400' :
          'bg-[#1a1a1a] border-white/5 text-white/30'
        }`}
      >
        {data.label}
      </div>

      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-[#2a2a2a] !border-white/10 !-mr-2" />
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

export default function PipelineCanvas({ currentStep }: PipelineCanvasProps) {
  const currentIndex = currentStep === 'standby' ? -1 : currentStep === 'complete' ? STAGES.length : STAGES.findIndex(s => s.id === currentStep);

  const nodes: Node[] = useMemo(() => {
    return STAGES.map((step, index) => {
      let status: 'complete' | 'active' | 'pending' = 'pending';
      if (currentIndex >= 0 && index < currentIndex) status = 'complete';
      if (index === currentIndex) status = 'active';

      return {
        id: step.id,
        type: 'custom',
        position: { x: index * 160, y: 100 }, // tighter spacing
        data: { ...step, status },
        draggable: false,
      };
    });
  }, [currentIndex]);

  const edges: Edge[] = useMemo(() => {
    return STAGES.slice(0, -1).map((step, index) => {
      const nextStep = STAGES[index + 1];
      const isPast = currentIndex >= 0 && index < currentIndex;
      const isAnimated = index === currentIndex;

      return {
        id: `e-${step.id}-${nextStep.id}`,
        source: step.id,
        target: nextStep.id,
        type: 'smoothstep',
        animated: isAnimated,
        style: {
          stroke: isPast ? 'rgba(255, 255, 255, 0.4)' : isAnimated ? 'rgba(249, 115, 22, 0.8)' : 'rgba(255, 255, 255, 0.1)',
          strokeWidth: 2,
        },
      };
    });
  }, [currentIndex]);

  return (
    <div className="w-full h-80 border border-white/10 rounded-2xl overflow-hidden bg-[#0d0d0d] shadow-inner">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultViewport={{ x: 60, y: 30, zoom: 1 }}
        minZoom={0.5}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={true}
        zoomOnScroll={false}
        zoomOnPinch={false}
        panOnScroll={true}
      >
        <Background color="rgba(255,255,255,0.05)" gap={20} />
        <Controls showInteractive={false} className="bg-[#1a1a1a] border-white/10 fill-white drop-shadow-md" />
      </ReactFlow>
    </div>
  );
}
