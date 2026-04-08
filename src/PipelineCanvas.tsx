import React, { useMemo } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  Position,
  Handle
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion } from 'motion/react';

export interface PipelineStep {
  id: string;
  label: string;
  status: 'complete' | 'active' | 'pending';
}

const CustomNode = ({ data }: { data: PipelineStep }) => {
  const isComplete = data.status === 'complete';
  const isActive = data.status === 'active';

  return (
    <>
      <Handle type="target" position={Position.Left} className="w-2 h-2 !bg-white/20 !border-white/10" />
      <motion.div
        className={`px-4 py-3 rounded-lg border-2 font-medium text-sm flex items-center justify-center min-w-[200px] text-center
          ${isComplete ? 'bg-green-500/10 border-green-500/30 text-green-400' :
            isActive ? 'bg-orange-500/10 border-orange-500/50 text-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.3)]' :
            'bg-white/5 border-white/10 text-white/40'}
        `}
        animate={isActive ? {
          boxShadow: ['0 0 10px rgba(249,115,22,0.2)', '0 0 25px rgba(249,115,22,0.6)', '0 0 10px rgba(249,115,22,0.2)'],
          borderColor: ['rgba(249,115,22,0.3)', 'rgba(249,115,22,0.8)', 'rgba(249,115,22,0.3)']
        } : {}}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        {data.label}
      </motion.div>
      <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-white/20 !border-white/10" />
    </>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

export default function PipelineCanvas({ steps }: { steps: PipelineStep[] }) {
  const nodes: Node[] = useMemo(() => {
    return steps.map((step, index) => ({
      id: step.id,
      type: 'custom',
      position: { x: index * 300, y: 50 }, // 300 horizontal spacing to prevent overlap
      data: step,
      draggable: false, // Override dragging at the node level
    }));
  }, [steps]);

  const edges: Edge[] = useMemo(() => {
    return steps.slice(0, -1).map((step, index) => {
      const nextStep = steps[index + 1];
      const isAnimated = step.status === 'complete' && nextStep.status === 'active';
      return {
        id: `e-${step.id}-${nextStep.id}`,
        source: step.id,
        target: nextStep.id,
        animated: isAnimated || nextStep.status === 'active',
        style: {
          stroke: step.status === 'complete' ? 'rgba(34, 197, 94, 0.5)' : 'rgba(255, 255, 255, 0.1)',
          strokeWidth: 2,
        },
      };
    });
  }, [steps]);

  return (
    <div className="w-full h-64 border border-white/10 rounded-2xl overflow-hidden bg-black/20">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        panOnScroll={true}
      >
        <Background color="rgba(255,255,255,0.05)" gap={20} />
      </ReactFlow>
    </div>
  );
}
