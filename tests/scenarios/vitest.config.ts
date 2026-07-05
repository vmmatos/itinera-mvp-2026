import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const financeAgentSrc = resolve(__dirname, '../../services/finance-agent/src');
const logisticsAgentSrc = resolve(__dirname, '../../services/logistics-agent/src');
const orchestratorSrc = resolve(__dirname, '../../services/orchestrator/src');

export default defineConfig({
  test: {
    silent: true,
  },
  resolve: {
    alias: [
      // Finance-agent internal @/ imports — must precede the generic @/ rule
      { find: '@/agents/BaseFinanceAgent', replacement: `${financeAgentSrc}/agents/BaseFinanceAgent` },
      { find: '@/agents/CostCalculator', replacement: `${financeAgentSrc}/agents/CostCalculator` },
      { find: '@/agents/BudgetValidator', replacement: `${financeAgentSrc}/agents/BudgetValidator` },
      // Logistics-agent internal @/ imports — must precede the generic @/ rule
      { find: '@/agents/BaseLogisticsAgent', replacement: `${logisticsAgentSrc}/agents/BaseLogisticsAgent` },
      // Orchestrator service imports for scenarios 008 + 010-015 — must precede the generic @/ rule
      { find: '@/services/NegotiationLoop',         replacement: `${orchestratorSrc}/services/NegotiationLoop` },
      { find: '@/services/WorkflowEngine',          replacement: `${orchestratorSrc}/services/WorkflowEngine` },
      { find: '@/services/WorkflowStateMachine',    replacement: `${orchestratorSrc}/services/WorkflowStateMachine` },
      { find: '@/services/TransportPriorityEngine', replacement: `${orchestratorSrc}/services/TransportPriorityEngine` },
      { find: '@/services/StateManager',            replacement: `${orchestratorSrc}/services/StateManager` },
      { find: '@/services/AgentCaller',             replacement: `${orchestratorSrc}/services/AgentCaller` },
      { find: '@/services/EventPublisher',          replacement: `${orchestratorSrc}/services/EventPublisher` },
      // Orchestrator-agent generic rule (covers ConflictAnalyzer, CompromiseGenerator, services)
      { find: '@', replacement: resolve(__dirname, '../../services/orchestrator-agent/src') },
      { find: '@itinera/shared', replacement: resolve(__dirname, '../../services/shared/src') },
    ],
  },
});
